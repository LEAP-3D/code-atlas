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

export class CodeWebviewProvider {
  // Store the current roadmap panel to reuse it
  private static currentRoadmapPanel: vscode.WebviewPanel | null = null;

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

  /**
   * Show error dependency graph
   */
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

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(
      async (message) => {
        console.log("📨 [ErrorGraph] Received message:", message);
        await this.handleWebviewMessage(message, context);
      },
      undefined,
      context.subscriptions,
    );
  }

  /**
   * Show roadmap view with new modular structure
   */
  static showRoadmap(context: vscode.ExtensionContext) {
    // If panel already exists, just reveal it
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
        retainContextWhenHidden: true, // Keep webview state when hidden
      },
    );

    this.currentRoadmapPanel = panel;

    // Clear reference when panel is disposed
    panel.onDidDispose(() => {
      console.log("🗑️ Roadmap panel disposed");
      this.currentRoadmapPanel = null;
    });

    panel.webview.html = this.getRoadmapHtml(panel.webview, context);

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(
      async (message) => {
        console.log("📨 [Roadmap] Received message:", message);
        if (message.command === "refreshRoadmapData") {
          try {
            const refreshedData = this.buildRoadmapData();
            await panel.webview.postMessage({
              type: "roadmapDataUpdated",
              data: refreshedData,
            });
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            await panel.webview.postMessage({
              type: "roadmapDataRefreshFailed",
              error: errorMsg,
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

  /**
   * Handle webview messages (shared between roadmap and error graph)
   */
  private static async handleWebviewMessage(
    message: {
      command: string;
      filePath?: string;
      line?: number;
      files?: string[];
      errors?: unknown[];
      errorFile?: string;
      context?: string;
    },
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
        await this.copyAIContext(message.errorFile!, message.context || "");
        break;

      case "showAllErrors":
        await vscode.commands.executeCommand("workbench.action.problems.focus");
        break;
    }
  }

  /**
   * Open file at specific line
   */
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

  /**
   * Copy file content to clipboard
   */
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

  /**
   * Copy multiple files to clipboard
   */
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

  /**
   * Copy AI context to clipboard
   */
  private static async copyAIContext(errorFile: string, aiContext: string) {
    try {
      if (!fs.existsSync(errorFile)) {
        throw new Error(`Error file not found: ${errorFile}`);
      }

      const errorFileContent = fs.readFileSync(errorFile, "utf-8");
      const fileName = path.basename(errorFile);

      const fullContext = aiContext.replace(
        `// ${fileName} content will be inserted here by the extension`,
        errorFileContent,
      );

      await vscode.env.clipboard.writeText(fullContext);
      vscode.window.showInformationMessage(
        `🤖 AI context copied! Ready to paste into ChatGPT/Claude`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to copy AI context: ${errorMsg}`);
    }
  }

  /**
   * Get roadmap HTML with modular structure
   */
  private static getRoadmapHtml(
    webview: vscode.Webview,
    context: vscode.ExtensionContext,
  ): string {
    // Get URIs for CSS and JS
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

    // Read HTML template
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
      // Build roadmap data
      const roadmapData = this.buildRoadmapData();

      console.log("📊 [getRoadmapHtml] Injecting roadmap data");
      console.log(`   Files: ${roadmapData.totalFiles}`);
      console.log(`   Functions: ${roadmapData.totalFunctions}`);
      console.log(`   Dependencies: ${roadmapData.dependencies.length}`);

      // Create data script
      const dataScript = `<script>window.ROADMAP_DATA = ${JSON.stringify(roadmapData, null, 2)};</script>`;

      // Replace placeholders
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

  /**
   * Get error graph HTML
   */
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

  /**
   * Build error graph data
   */
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

  /**
   * Build roadmap data
   */
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
      };
    }

    // Get errors by file
    const errorsByFile = new Map<string, number>();
    const allDiagnostics = vscode.languages.getDiagnostics();
    for (const [uri, diagnostics] of allDiagnostics) {
      const errorCount = diagnostics.filter(
        (d) => d.severity === vscode.DiagnosticSeverity.Error,
      ).length;
      if (errorCount > 0) {
        errorsByFile.set(uri.fsPath, errorCount);
      }
    }

    // Build roadmap files
    const roadmapFiles: RoadmapFile[] = [];

    for (const file of files) {
      const fileName = file.path.split(/[/\\]/).pop() || file.path;
      const fileFunctions = allFunctions.filter(
        (fn) => fn.filePath === file.path,
      );

      if (fileFunctions.length === 0) {
        continue;
      }

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

    return {
      files: roadmapFiles,
      dependencies: dependenciesForFrontend,
      totalFiles: roadmapFiles.length,
      totalFunctions: roadmapFiles.reduce(
        (sum, f) => sum + f.functions.length,
        0,
      ),
      totalConnections: allEdges.length,
    };
  }

  /**
   * Get function emoji based on name
   */
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

  /**
   * Get error HTML (fallback)
   */
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

  /**
   * Get debug HTML (old method - kept for backward compatibility)
   */
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

  /**
   * Escape HTML special characters
   */
  private static escape(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
