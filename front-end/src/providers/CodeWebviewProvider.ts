import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { fileIndex } from "../state/fileIndex";
import { functionIndex } from "../state/functionIndex";
import { callGraphIndex } from "../state/callGraphIndex";
import { dependencyIndex } from "../state/dependencyIndex";
import {
  RoadmapData,
  RoadmapFile,
  RoadmapFunction,
  RoadmapDependency,
} from "../roadmap/roadmapModel";
import {
  RoadmapCommandMessage,
  RoadmapDiagnosticItem,
  isRoadmapCommandMessage,
} from "../webview/roadmap/messages";

export class CodeWebviewProvider {
  private static currentRoadmapPanel: vscode.WebviewPanel | null = null;
  private static extensionContext: vscode.ExtensionContext | null = null;
  private static readonly BASELINE_KEY = "roadmap.errorBaseline";

  static show(
    context: vscode.ExtensionContext,
    data: {
      summary: string;
      errorText: string;
      relevantCode: string;
      selectedCode: string;
      mermaidDiagram: string;
    },
  ) {
    const panel = vscode.window.createWebviewPanel(
      "codeExplanation",
      "Filtered Prompt Preview",
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );

    panel.webview.html = this.getHtml(panel.webview, context, data);
  }

  static showErrorDependencyGraph(
    context: vscode.ExtensionContext,
    errorFilePath: string,
  ) {
    const panel = vscode.window.createWebviewPanel(
      "errorDependencyGraph",
      "🐛 Error Dependency Graph",
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );

    panel.webview.html = this.getErrorGraphHtml(
      panel.webview,
      context,
      errorFilePath,
    );

    panel.webview.onDidReceiveMessage(
      async (message: unknown) => {
        if (!isRoadmapCommandMessage(message)) {
          console.warn("[ErrorGraph] Ignored malformed message payload");
          return;
        }
        await this.handleWebviewMessage(message, context);
      },
      undefined,
      context.subscriptions,
    );
  }

  static showRoadmap(context: vscode.ExtensionContext) {
    this.extensionContext = context;
    if (this.currentRoadmapPanel) {
      this.currentRoadmapPanel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "roadmapView",
      "📊 Project Roadmap",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [context.extensionUri],
        retainContextWhenHidden: true,
      },
    );

    this.currentRoadmapPanel = panel;

    panel.onDidDispose(() => {
      console.log("🗑️ Roadmap panel disposed");
      this.currentRoadmapPanel = null;
    });

    panel.webview.html = this.getRoadmapHtml(panel.webview, context);

    panel.webview.onDidReceiveMessage(
      async (message: unknown) => {
        if (!isRoadmapCommandMessage(message)) {
          console.warn("[Roadmap] Ignored malformed message payload");
          return;
        }

        if (message.command === "refreshRoadmapData") {
          try {
            const refreshedData = this.buildRoadmapData();
            await panel.webview.postMessage({
              type: "roadmapDataUpdated",
              data: refreshedData,
              updatedAt: Date.now(),
            });
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            await panel.webview.postMessage({
              type: "roadmapDataRefreshFailed",
              error: errorMsg,
              updatedAt: Date.now(),
            });
          }
          return;
        }
        await this.handleWebviewMessage(message, context);
      },
      undefined,
      context.subscriptions,
    );
  }

  static async updateRoadmapPanelData(data: RoadmapData) {
    if (!this.currentRoadmapPanel) {
      return;
    }

    await this.currentRoadmapPanel.webview.postMessage({
      type: "roadmapDataUpdated",
      data,
      updatedAt: Date.now(),
    });
  }

  static async refreshRoadmapPanelFromIndexes() {
    if (!this.currentRoadmapPanel) {
      return;
    }

    const refreshedData = this.buildRoadmapData();
    await this.updateRoadmapPanelData(refreshedData);
  }

  static async showRoadmapMonorepoPrompt(
    context: vscode.ExtensionContext,
    workspaceName: string,
  ) {
    this.extensionContext = context;
    this.showRoadmap(context);

    await this.updateRoadmapPanelData({
      files: [],
      dependencies: [],
      totalFiles: 0,
      totalFunctions: 0,
      totalConnections: 0,
    });

    if (!this.currentRoadmapPanel) {
      return;
    }

    await this.currentRoadmapPanel.webview.postMessage({
      type: "roadmapEmptyState",
      title: "Monorepo detected",
      message: `This workspace (${workspaceName}) is a monorepo. Choose the project you want to see the roadmap of.`,
      actionLabel: "Choose Project",
      actionCommand: "pickMonorepoRoadmapProject",
    });
  }

  private static async handleWebviewMessage(
    message: RoadmapCommandMessage,
    context: vscode.ExtensionContext,
  ) {
    switch (message.command) {
      case "goToFunction":
      case "openFile":
        await this.openFileAtLine(message.filePath!, message.line);
        break;

      case "goToLine":
        await this.openFileAtLine(message.filePath!, message.line, true);
        break;

      case "debugExecutionFlow":
        this.showErrorDependencyGraph(context, message.filePath!);
        break;

      case "copyFile":
        await this.copyFileToClipboard(message.filePath!);
        break;

      case "copyAllFiles":
        await this.copyAllFilesToClipboard(message.files || []);
        break;

      case "copyAIContext":
        await this.copyAIContext(
          message.errorFile!,
          message.context || "",
          message.files,
        );
        break;

      case "copySmartAIContext":
        await this.copySmartAIContext(
          message.filePath!,
          Boolean(message.includeRelatedFiles),
          message.files,
        );
        break;

      case "getErrorDetails":
        await this.sendErrorDetails(
          message.filePath!,
          message.requestId!,
          Boolean(message.includeWarnings),
        );
        break;

      case "showAllErrors":
        await vscode.commands.executeCommand("workbench.action.problems.focus");
        break;

      case "pickMonorepoRoadmapProject":
        await vscode.commands.executeCommand(
          "experiment.pickMonorepoRoadmapProject",
        );
        break;
    }
  }

  private static async openFileAtLine(
    filePath: string,
    line?: number,
    highlight = false,
  ) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const uri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(
        document,
        vscode.ViewColumn.One,
      );

      if (line) {
        const targetLine = Math.max(0, line - 1);
        const range = new vscode.Range(targetLine, 0, targetLine, 0);
        editor.selection = new vscode.Selection(range.start, range.start);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

        if (highlight) {
          const decoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor(
              "editor.findMatchHighlightBackground",
            ),
            isWholeLine: true,
          });
          editor.setDecorations(decoration, [range]);
          setTimeout(() => decoration.dispose(), 2000);
        }
      }

      vscode.window.showInformationMessage(
        `📍 ${line ? `Jumped to line ${line}` : `Opened ${path.basename(filePath)}`}`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to open file: ${errorMsg}`);
    }
  }

  private static async copyFileToClipboard(filePath: string) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      const content = fs.readFileSync(filePath, "utf-8");
      await vscode.env.clipboard.writeText(content);
      vscode.window.showInformationMessage(
        `📋 Copied ${path.basename(filePath)} to clipboard`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to copy file: ${errorMsg}`);
    }
  }

  private static async copyAllFilesToClipboard(files: string[]) {
    try {
      let combinedContent = "";
      let successCount = 0;

      for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        if (!fs.existsSync(filePath)) {
          continue;
        }

        const fileName = path.basename(filePath);
        const content = fs.readFileSync(filePath, "utf-8");

        combinedContent += `// ========================================\n`;
        combinedContent += `// File: ${fileName}\n`;
        combinedContent += `// Path: ${filePath}\n`;
        combinedContent += `// ========================================\n\n`;
        combinedContent += content;
        if (i < files.length - 1) {
          combinedContent += "\n\n";
        }

        successCount++;
      }

      if (successCount === 0) {
        throw new Error("No files could be read");
      }

      await vscode.env.clipboard.writeText(combinedContent);
      vscode.window.showInformationMessage(
        `📋 Copied ${successCount} file(s) to clipboard!`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to copy files: ${errorMsg}`);
    }
  }

  private static async copyAIContext(
    errorFile: string,
    aiContext: string,
    files?: string[],
  ) {
    try {
      if (!fs.existsSync(errorFile)) {
        throw new Error(`Error file not found: ${errorFile}`);
      }

      const errorFileContent = fs.readFileSync(errorFile, "utf-8");
      const fileName = path.basename(errorFile);

      let fullContext = aiContext.replace(
        `// ${fileName} content will be inserted here by the extension`,
        errorFileContent,
      );

      if (files && files.length > 1) {
        fullContext += `\n\n---\n\n## Related Files\n\n`;

        for (const filePath of files) {
          if (filePath === errorFile) continue;

          if (!fs.existsSync(filePath)) continue;

          const relatedFileName = path.basename(filePath);
          const relatedContent = fs.readFileSync(filePath, "utf-8");

          fullContext += `### ${relatedFileName}\n\n`;
          fullContext += `\`\`\`javascript\n`;
          fullContext += relatedContent;
          fullContext += `\n\`\`\`\n\n`;
        }
      }

      await vscode.env.clipboard.writeText(fullContext);

      const fileCount =
        files && files.length > 1 ? `${files.length} files` : "context";
      vscode.window.showInformationMessage(
        `🤖 AI ${fileCount} copied! Ready for ChatGPT/Claude`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to copy AI context: ${errorMsg}`);
    }
  }

  private static severityOrder(severity: vscode.DiagnosticSeverity): number {
    if (severity === vscode.DiagnosticSeverity.Error) return 0;
    if (severity === vscode.DiagnosticSeverity.Warning) return 1;
    if (severity === vscode.DiagnosticSeverity.Information) return 2;
    return 3;
  }

  private static severityShort(severity: vscode.DiagnosticSeverity): string {
    if (severity === vscode.DiagnosticSeverity.Error) return "E";
    if (severity === vscode.DiagnosticSeverity.Warning) return "W";
    if (severity === vscode.DiagnosticSeverity.Information) return "I";
    return "H";
  }

  private static getLanguageFence(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".ts") return "ts";
    if (ext === ".tsx") return "tsx";
    if (ext === ".js") return "js";
    if (ext === ".jsx") return "jsx";
    if (ext === ".json") return "json";
    return "";
  }

  private static getDiagnosticsForFile(filePath: string): vscode.Diagnostic[] {
    const uri = vscode.Uri.file(filePath);
    const direct = vscode.languages.getDiagnostics(uri);
    if (direct.length > 0) {
      return direct;
    }

    const target = this.normalizeFsPath(uri.fsPath);
    const targetLoose = target.replace(/\\/g, "/");
    const fallback: vscode.Diagnostic[] = [];
    for (const [diagUri, diagItems] of vscode.languages.getDiagnostics()) {
      const normalizedDiagPath = this.normalizeFsPath(diagUri.fsPath);
      const diagLoose = normalizedDiagPath.replace(/\\/g, "/");
      const isExact = normalizedDiagPath === target;
      const isLooseSuffixMatch =
        diagLoose.endsWith(targetLoose) || targetLoose.endsWith(diagLoose);
      if (isExact || isLooseSuffixMatch) {
        fallback.push(...diagItems);
      }
    }
    return fallback;
  }

  private static getDiagnosticCode(d: vscode.Diagnostic): string {
    if (d.code === undefined) return "n/a";
    if (typeof d.code === "string" || typeof d.code === "number") {
      return String(d.code);
    }
    return String(d.code.value);
  }

  private static readSnippetAtLine(
    filePath: string,
    line: number,
    radius = 2,
  ): string {
    if (!fs.existsSync(filePath)) {
      return "// file not found";
    }
    const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
    const start = Math.max(1, line - radius);
    const end = Math.min(lines.length, line + radius);
    const out: string[] = [];
    for (let ln = start; ln <= end; ln++) {
      const marker = ln === line ? ">" : " ";
      out.push(`${marker}${ln.toString().padStart(4, " ")} | ${lines[ln - 1]}`);
    }
    return out.join("\n");
  }

  private static collectRelatedFiles(filePath: string): string[] {
    const imports = dependencyIndex.getImportsOf(filePath);
    const importedBy = dependencyIndex.getImportersOf(filePath);
    const files = new Set<string>([path.normalize(filePath)]);
    for (const dep of imports) files.add(path.normalize(dep.importedFilePath));
    for (const dep of importedBy) files.add(path.normalize(dep.importerFilePath));
    return Array.from(files);
  }

  private static resolveRelatedFileCandidates(
    filePath: string,
    hintedRelatedFiles?: string[],
  ): string[] {
    const normalizedTarget = this.normalizeFsPath(filePath);
    const candidates = [
      ...(hintedRelatedFiles || []),
      ...this.collectRelatedFiles(filePath),
    ];

    const dedup = new Map<string, string>();
    for (const candidate of candidates) {
      if (!candidate) continue;
      const normalizedPath = path.normalize(candidate);
      const normalizedKey = this.normalizeFsPath(normalizedPath);
      if (normalizedKey === normalizedTarget) continue;
      if (!dedup.has(normalizedKey)) {
        dedup.set(normalizedKey, normalizedPath);
      }
    }

    return Array.from(dedup.values()).filter((p) => fs.existsSync(p));
  }

  private static groupRootCauses(
    diagnostics: vscode.Diagnostic[],
  ): Array<{ key: string; count: number; firstLine: number; title: string }> {
    const groups = new Map<
      string,
      { key: string; count: number; firstLine: number; title: string }
    >();
    for (const d of diagnostics) {
      if (d.severity !== vscode.DiagnosticSeverity.Error) continue;
      const code = this.getDiagnosticCode(d);
      const source = d.source || "diagnostic";
      const key = `${source}:${code}`;
      const current = groups.get(key) || {
        key,
        count: 0,
        firstLine: d.range.start.line + 1,
        title: `${source}(${code})`,
      };
      current.count += 1;
      current.firstLine = Math.min(current.firstLine, d.range.start.line + 1);
      groups.set(key, current);
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.firstLine - b.firstLine;
    });
  }

  private static async copySmartAIContext(
    filePath: string,
    includeRelatedFiles: boolean,
    hintedRelatedFiles?: string[],
  ) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const diagnostics = this.getDiagnosticsForFile(filePath).sort((a, b) => {
        const bySeverity = this.severityOrder(a.severity) - this.severityOrder(b.severity);
        if (bySeverity !== 0) return bySeverity;
        return a.range.start.line - b.range.start.line;
      });
      const fileName = path.basename(filePath);
      const language = this.getLanguageFence(filePath);
      const rootGroups = this.groupRootCauses(diagnostics);
      const imports = dependencyIndex.getImportsOf(filePath);
      const importedBy = dependencyIndex.getImportersOf(filePath);

      let context = `# Fix Context (${fileName})\n\n`;
      context += `## Priority\n`;
      context += `- Fix ERROR first, then WARNING, then INFO/HINT.\n`;
      context += `- If syntax/root-cause exists, fix it before downstream diagnostics.\n\n`;

      context += `## File\n`;
      context += `- Path: ${filePath}\n`;
      context += `- Language: ${language || "plain"}\n`;
      context += `- Diagnostics: ${diagnostics.length}\n\n`;

      if (rootGroups.length > 0) {
        context += `## Root Causes (Fix First)\n`;
        rootGroups.slice(0, 6).forEach((group, idx) => {
          context += `${idx + 1}. ${group.title} | count=${group.count} | firstLine=${group.firstLine}\n`;
        });
        context += `\n`;
      }

      context += `## Diagnostics (E->W->I->H)\n`;
      if (diagnostics.length === 0) {
        context += `- No diagnostics returned by VS Code for this file.\n\n`;
      } else {
        for (const d of diagnostics) {
          const line = d.range.start.line + 1;
          const col = d.range.start.character + 1;
          const code = this.getDiagnosticCode(d);
          const source = d.source || "unknown";
          context += `- [${this.severityShort(d.severity)}] ${source}(${code}) at ${line}:${col} -> ${d.message}\n`;
        }
        context += `\n`;
      }

      context += `## Error Line Snippets\n`;
      const snippetLines = new Set<number>();
      diagnostics
        .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
        .slice(0, 20)
        .forEach((d) => snippetLines.add(d.range.start.line + 1));
      if (snippetLines.size === 0 && diagnostics.length > 0) {
        diagnostics.slice(0, 8).forEach((d) => snippetLines.add(d.range.start.line + 1));
      }
      if (snippetLines.size === 0) {
        context += `- No diagnostic snippet available.\n\n`;
      } else {
        Array.from(snippetLines)
          .sort((a, b) => a - b)
          .forEach((line) => {
            context += `### Around line ${line}\n`;
            context += "```text\n";
            context += this.readSnippetAtLine(filePath, line, 2);
            context += "\n```\n\n";
          });
      }

      context += `## Import Context\n`;
      context += `- Imports: ${imports.length}\n`;
      imports.slice(0, 25).forEach((dep) => {
        context += `  - ${path.basename(dep.importedFilePath)}: ${dep.importedNames.join(", ")}\n`;
      });
      context += `- Imported By: ${importedBy.length}\n`;
      importedBy.slice(0, 25).forEach((dep) => {
        context += `  - ${path.basename(dep.importerFilePath)}: ${dep.importedNames.join(", ")}\n`;
      });
      context += `\n`;

      context += `## Target File Content\n`;
      context += `\`\`\`${language}\n`;
      context += fs.readFileSync(filePath, "utf-8");
      context += `\n\`\`\`\n\n`;
      if (includeRelatedFiles) {
        const relatedFiles = this.resolveRelatedFileCandidates(
          filePath,
          hintedRelatedFiles,
        );
        if (relatedFiles.length > 0) {
          context += `## Related Files (for reference)\n`;
          for (const related of relatedFiles.slice(0, 15)) {
            context += `### ${path.basename(related)}\n`;
            context += `\`\`\`${this.getLanguageFence(related)}\n`;
            context += fs.readFileSync(related, "utf-8");
            context += `\n\`\`\`\n\n`;
          }
        } else {
          context += `## Related Files (for reference)\n- None resolved from dependency graph.\n\n`;
        }
      }

      context += `## Required Output\n`;
      context += `1. Root-cause first fix order.\n`;
      context += `2. Return full corrected ${fileName} only.\n`;
      context += `3. Keep behavior unchanged except bug fixes.\n`;
      context += `4. If import/type changes are needed, include them in this file.\n`;

      await vscode.env.clipboard.writeText(context);
      vscode.window.showInformationMessage(
        `🤖 Smart AI fix context copied (${includeRelatedFiles ? "with related files" : "single file"})`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to copy smart AI context: ${errorMsg}`);
    }
  }

  private static mapSeverity(
    severity: vscode.DiagnosticSeverity,
  ): RoadmapDiagnosticItem["severity"] {
    if (severity === vscode.DiagnosticSeverity.Error) return "error";
    if (severity === vscode.DiagnosticSeverity.Warning) return "warning";
    if (severity === vscode.DiagnosticSeverity.Information) return "info";
    return "hint";
  }

  private static normalizeFsPath(filePath: string): string {
    const normalized = path.normalize(filePath);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  }

  private static async sendErrorDetails(
    filePath: string,
    requestId: string,
    includeWarnings: boolean,
  ) {
    if (!this.currentRoadmapPanel) {
      return;
    }

    try {
      let diagnostics = this.getDiagnosticsForFile(filePath);
      if (diagnostics.length === 0) {
        // Trigger diagnostics provider for unopened files, then retry once.
        await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await new Promise((resolve) => setTimeout(resolve, 120));
        diagnostics = this.getDiagnosticsForFile(filePath);
      }

      const allowed = includeWarnings
        ? [
            vscode.DiagnosticSeverity.Error,
            vscode.DiagnosticSeverity.Warning,
            vscode.DiagnosticSeverity.Information,
            vscode.DiagnosticSeverity.Hint,
          ]
        : [vscode.DiagnosticSeverity.Error];

      const issues: RoadmapDiagnosticItem[] = diagnostics
        .filter((d) => allowed.includes(d.severity))
        .map((d) => ({
          line: d.range.start.line + 1,
          message: d.message,
          severity: this.mapSeverity(d.severity),
          code: (() => {
            if (d.code === undefined) {
              return undefined;
            }
            if (typeof d.code === "string" || typeof d.code === "number") {
              return String(d.code);
            }
            return String(d.code.value);
          })(),
          source: d.source,
        }));

      await this.currentRoadmapPanel.webview.postMessage({
        type: "errorDetails",
        filePath,
        requestId,
        issues,
      });
    } catch (error) {
      console.error("Failed to send diagnostics:", error);
      await this.currentRoadmapPanel.webview.postMessage({
        type: "errorDetails",
        filePath,
        requestId,
        issues: [],
      });
    }
  }

  private static getRoadmapHtml(
    webview: vscode.Webview,
    context: vscode.ExtensionContext,
  ): string {
    const stylesPath = vscode.Uri.joinPath(
      context.extensionUri,
      "src",
      "webview",
      "roadmap",
      "styles.css",
    );
    const stylesUri = webview.asWebviewUri(stylesPath);

    const scriptPath = vscode.Uri.joinPath(
      context.extensionUri,
      "out",
      "webview",
      "roadmap.js",
    );
    const scriptUri = webview.asWebviewUri(scriptPath);

    const htmlPath = path.join(
      context.extensionPath,
      "src",
      "webview",
      "roadmap",
      "index.html",
    );

    if (!fs.existsSync(htmlPath)) {
      console.error(`❌ HTML file not found: ${htmlPath}`);
      return this.getErrorHtml("Roadmap HTML file not found");
    }

    let html = fs.readFileSync(htmlPath, "utf8");

    try {
      const roadmapData = this.buildRoadmapData();

      console.log("📊 [getRoadmapHtml] Injecting roadmap data");
      console.log(`   Files: ${roadmapData.totalFiles}`);
      console.log(`   Functions: ${roadmapData.totalFunctions}`);
      console.log(`   Dependencies: ${roadmapData.dependencies.length}`);

      const dataScript = `<script>window.ROADMAP_DATA = ${JSON.stringify(roadmapData, null, 2)};</script>`;

      html = html.replace("{{STYLES_URI}}", stylesUri.toString());
      html = html.replace("{{SCRIPT_URI}}", scriptUri.toString());
      html = html.replace("{{DATA_SCRIPT}}", dataScript);

      return html;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("❌ [getRoadmapHtml] Error building roadmap:", errorMsg);
      return this.getErrorHtml(`Error building roadmap: ${errorMsg}`);
    }
  }

  private static getErrorGraphHtml(
    _webview: vscode.Webview,
    context: vscode.ExtensionContext,
    errorFilePath: string,
  ): string {
    const htmlPath = path.join(
      context.extensionPath,
      "src",
      "webview",
      "error-dependency-graph.html",
    );

    if (!fs.existsSync(htmlPath)) {
      console.error(`❌ HTML file not found: ${htmlPath}`);
      return this.getErrorHtml("Error dependency graph HTML file not found");
    }

    let html = fs.readFileSync(htmlPath, "utf8");

    try {
      const errorGraphData = this.buildErrorGraphData(errorFilePath);

      console.log("🐛 [getErrorGraphHtml] Injecting error graph data");
      console.log(`   Error file: ${errorFilePath}`);
      console.log(`   Errors: ${errorGraphData.errors.length}`);
      console.log(`   Dependencies: ${errorGraphData.dependencies.length}`);

      const dataScript = `<script>window.ERROR_GRAPH_DATA = ${JSON.stringify(errorGraphData, null, 2)};</script>`;
      html = html.replace("</head>", `${dataScript}\n</head>`);

      return html;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("❌ [getErrorGraphHtml] Error building graph:", errorMsg);
      return this.getErrorHtml(`Error building dependency graph: ${errorMsg}`);
    }
  }

  private static buildErrorGraphData(errorFilePath: string) {
    const uri = vscode.Uri.file(errorFilePath);
    const diagnostics = vscode.languages.getDiagnostics(uri);

    const errors = diagnostics
      .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
      .map((d) => ({
        line: d.range.start.line + 1,
        message: d.message,
        severity: d.severity,
      }));

    const allDependencies = dependencyIndex.getAll();
    const relatedDependencies = allDependencies.filter(
      (dep) =>
        dep.importerFilePath === errorFilePath ||
        dep.importedFilePath === errorFilePath,
    );

    const relatedFilePaths = new Set<string>();
    relatedFilePaths.add(errorFilePath);
    relatedDependencies.forEach((dep) => {
      relatedFilePaths.add(dep.importerFilePath);
      relatedFilePaths.add(dep.importedFilePath);
    });

    const allFiles = Array.from(relatedFilePaths).map((filePath) => {
      const functions = functionIndex
        .getAll()
        .filter((fn) => fn.filePath === filePath);
      return {
        path: filePath,
        functions: functions.map((fn) => ({
          name: fn.name,
          emoji: this.getFunctionEmoji(fn.name),
          startLine: fn.startLine,
          endLine: fn.endLine,
          calls: callGraphIndex
            .getAll()
            .filter((edge) => edge.callerId === fn.id)
            .map((edge) => edge.calleeName),
        })),
      };
    });

    return {
      errorFile: errorFilePath,
      errors,
      dependencies: relatedDependencies,
      allFiles,
    };
  }

  private static formatTodayKey(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  private static getErrorBaseline(currentErrorCount: number) {
    const today = this.formatTodayKey();
    const context = this.extensionContext;
    const stored = context?.workspaceState.get<{
      date: string;
      baselineErrorCount: number;
    }>(this.BASELINE_KEY);

    if (!context) {
      return {
        date: today,
        baselineErrorCount: currentErrorCount,
        currentErrorCount,
        deltaFromBaseline: 0,
      };
    }

    if (!stored || stored.date !== today) {
      const next = { date: today, baselineErrorCount: currentErrorCount };
      void context.workspaceState.update(this.BASELINE_KEY, next);
      return {
        ...next,
        currentErrorCount,
        deltaFromBaseline: 0,
      };
    }

    return {
      date: stored.date,
      baselineErrorCount: stored.baselineErrorCount,
      currentErrorCount,
      deltaFromBaseline: currentErrorCount - stored.baselineErrorCount,
    };
  }

  private static buildRoadmapData(): RoadmapData {
    console.log("🔨 [buildRoadmapData] Building roadmap...");

    const files = fileIndex.getAll();
    const allFunctions = functionIndex.getAll();
    const allEdges = callGraphIndex.getAll();
    const allDependencies = dependencyIndex.getAll();

    if (files.length === 0) {
      return {
        files: [],
        dependencies: [],
        totalFiles: 0,
        totalFunctions: 0,
        totalConnections: 0,
        diagnosticsSummary: {
          error: 0,
          warning: 0,
          info: 0,
          hint: 0,
          total: 0,
        },
        errorBaseline: this.getErrorBaseline(0),
      };
    }

    const errorsByFile = new Map<string, number>();
    const diagnosticsSummary = {
      error: 0,
      warning: 0,
      info: 0,
      hint: 0,
      total: 0,
    };
    const allDiagnostics = vscode.languages.getDiagnostics();
    for (const [uri, diagnostics] of allDiagnostics) {
      let errorCount = 0;
      let warningCount = 0;
      let infoCount = 0;
      let hintCount = 0;
      for (const d of diagnostics) {
        if (d.severity === vscode.DiagnosticSeverity.Error) errorCount += 1;
        else if (d.severity === vscode.DiagnosticSeverity.Warning) warningCount += 1;
        else if (d.severity === vscode.DiagnosticSeverity.Information) infoCount += 1;
        else hintCount += 1;
      }
      diagnosticsSummary.error += errorCount;
      diagnosticsSummary.warning += warningCount;
      diagnosticsSummary.info += infoCount;
      diagnosticsSummary.hint += hintCount;
      diagnosticsSummary.total += diagnostics.length;

      if (errorCount > 0) {
        errorsByFile.set(uri.fsPath, errorCount);
      }
    }

    const roadmapFiles: RoadmapFile[] = [];

    for (const file of files) {
      const fileName = file.path.split(/[/\\]/).pop() || file.path;
      const fileFunctions = allFunctions.filter(
        (fn) => fn.filePath === file.path,
      );

      const functions: RoadmapFunction[] = fileFunctions.map((fn) => {
        const calls = allEdges
          .filter((edge) => edge.callerId === fn.id)
          .map((edge) => edge.calleeName);

        return {
          name: fn.name,
          filePath: fn.filePath,
          emoji: this.getFunctionEmoji(fn.name),
          calls,
          startLine: fn.startLine,
          endLine: fn.endLine,
        };
      });

      const errorCount = errorsByFile.get(file.path) || 0;

      roadmapFiles.push({
        name: fileName,
        path: file.path,
        functions,
        color: errorCount > 0 ? "#ef4444" : "#3b82f6",
        errorCount,
      });
    }

    const dependenciesForFrontend: RoadmapDependency[] = allDependencies.map(
      (dep) => ({
        importerFilePath: dep.importerFilePath,
        importedFilePath: dep.importedFilePath,
        importedNames: dep.importedNames,
        importPath: dep.importPath,
      }),
    );

    console.log(`✅ Нийт ${roadmapFiles.length} файл roadmap-д нэмэгдлээ`);

    const errorBaseline = this.getErrorBaseline(diagnosticsSummary.error);

    return {
      files: roadmapFiles,
      dependencies: dependenciesForFrontend,
      totalFiles: roadmapFiles.length,
      totalFunctions: roadmapFiles.reduce(
        (sum, f) => sum + f.functions.length,
        0,
      ),
      totalConnections: allEdges.length,
      diagnosticsSummary,
      errorBaseline,
    };
  }

  private static getFunctionEmoji(name: string): string {
    const lower = name.toLowerCase();
    if (
      lower.startsWith("handle") ||
      lower.includes("click") ||
      lower.includes("submit")
    ) {
      return "🎯";
    }
    if (lower.startsWith("use") || lower.includes("hook")) {
      return "🪝";
    }
    if (
      lower.includes("fetch") ||
      lower.includes("get") ||
      lower.includes("load")
    ) {
      return "📥";
    }
    if (
      lower.includes("save") ||
      lower.includes("update") ||
      lower.includes("post")
    ) {
      return "💾";
    }
    if (lower.includes("render") || lower.includes("component")) {
      return "🎨";
    }
    if (
      lower.includes("analyze") ||
      lower.includes("build") ||
      lower.includes("process")
    ) {
      return "⚙️";
    }
    return "⚡";
  }

  private static getErrorHtml(errorMessage: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
    }
    .error-container { text-align: center; max-width: 500px; }
    .error-icon { font-size: 48px; margin-bottom: 16px; }
    .error-message { font-size: 16px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-icon">⚠️</div>
    <div class="error-message">${this.escape(errorMessage)}</div>
  </div>
</body>
</html>`;
  }

  private static getHtml(
    _webview: vscode.Webview,
    context: vscode.ExtensionContext,
    data: {
      summary: string;
      errorText: string;
      relevantCode: string;
      selectedCode: string;
      mermaidDiagram: string;
    },
  ): string {
    const htmlPath = path.join(
      context.extensionPath,
      "src",
      "webview",
      "index.html",
    );

    if (!fs.existsSync(htmlPath)) {
      return this.getErrorHtml("Debug HTML file not found");
    }

    let html = fs.readFileSync(htmlPath, "utf8");

    html = html
      .replace("{{SUMMARY}}", this.escape(data.summary))
      .replace("{{ERROR}}", this.escape(data.errorText))
      .replace("{{RELEVANT}}", this.escape(data.relevantCode))
      .replace("{{SELECTED}}", this.escape(data.selectedCode))
      .replace("{{MERMAID}}", this.escape(data.mermaidDiagram));

    return html;
  }

  private static escape(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}


