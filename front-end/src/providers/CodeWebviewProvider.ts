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

