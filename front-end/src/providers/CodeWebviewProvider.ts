import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { fileIndex } from "../state/fileIndex";
import { functionIndex } from "../state/functionIndex";
import { callGraphIndex } from "../state/callGraphIndex";
import {
  RoadmapData,
  RoadmapFile,
  RoadmapFunction,
} from "../roadmap/roadmapModel";

export class CodeWebviewProvider {
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

  static showRoadmap(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
      "roadmapView",
      "📊 Project Roadmap",
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );

    panel.webview.html = this.getRoadmapHtml(panel.webview, context);

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(
      async (message) => {
        console.log("📨 [CodeWebviewProvider] Received message:", message);

        if (message.command === "goToFunction") {
          try {
            const filePath = message.filePath;
            const line = message.line || 1;

            console.log(`🎯 [goToFunction] Opening: ${filePath}:${line}`);

            // Validate file exists
            if (!fs.existsSync(filePath)) {
              throw new Error(`File not found: ${filePath}`);
            }

            // Open file
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(
              document,
              vscode.ViewColumn.One,
            );

            // Navigate to line (VS Code uses 0-based indexing)
            const targetLine = Math.max(0, line - 1);
            const range = new vscode.Range(targetLine, 0, targetLine, 0);

            // Set cursor position
            editor.selection = new vscode.Selection(range.start, range.start);

            // Reveal line in center
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

            // Highlight line temporarily (2 seconds)
            const decoration = vscode.window.createTextEditorDecorationType({
              backgroundColor: new vscode.ThemeColor(
                "editor.findMatchHighlightBackground",
              ),
              isWholeLine: true,
            });

            editor.setDecorations(decoration, [range]);

            setTimeout(() => {
              decoration.dispose();
            }, 2000);

            const fileName = path.basename(filePath);
            vscode.window.showInformationMessage(
              `📍 Jumped to ${fileName}:${line}`,
            );
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            console.error("❌ [goToFunction] Error:", errorMsg);
            vscode.window.showErrorMessage(`Failed to open file: ${errorMsg}`);
          }
        }
      },
      undefined,
      context.subscriptions,
    );
  }

  private static getRoadmapHtml(
    webview: vscode.Webview,
    context: vscode.ExtensionContext,
  ): string {
    const htmlPath = path.join(
      context.extensionPath,
      "src",
      "webview",
      "roadmap.html",
    );

    if (!fs.existsSync(htmlPath)) {
      console.error(`❌ HTML file not found: ${htmlPath}`);
      return this.getErrorHtml("Roadmap HTML file not found");
    }

    let html = fs.readFileSync(htmlPath, "utf8");

    try {
      // Build roadmap data structure
      const roadmapData = this.buildRoadmapData();

      console.log("📊 [getRoadmapHtml] Injecting roadmap data");
      console.log(`   Files: ${roadmapData.totalFiles}`);
      console.log(`   Functions: ${roadmapData.totalFunctions}`);
      console.log(`   Connections: ${roadmapData.totalConnections}`);

      // Inject data as JSON
      const dataScript = `<script>window.ROADMAP_DATA = ${JSON.stringify(
        roadmapData,
        null,
        2,
      )};</script>`;

      // Insert before </head>
      html = html.replace("</head>", `${dataScript}\n</head>`);

      return html;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("❌ [getRoadmapHtml] Error building roadmap:", errorMsg);
      return this.getErrorHtml(`Error building roadmap: ${errorMsg}`);
    }
  }

  private static buildRoadmapData(): RoadmapData {
    console.log("🔨 [buildRoadmapData] Building roadmap...");

    const files = fileIndex.getAll();
    const allFunctions = functionIndex.getAll();
    const allEdges = callGraphIndex.getAll();

    console.log(`   📁 Files indexed: ${files.length}`);
    console.log(`   ⚡ Functions indexed: ${allFunctions.length}`);
    console.log(`   🔗 Call edges: ${allEdges.length}`);

    if (files.length === 0) {
      console.warn("⚠️  No files indexed!");
      return {
        files: [],
        totalFiles: 0,
        totalFunctions: 0,
        totalConnections: 0,
      };
    }

    // ✅ ЗАСВАР: Бүх workspace-ийн diagnostics-ийг цуглуулах
    const errorsByFile = new Map<string, number>();

    console.log(
      "\n🔍 [buildRoadmapData] Collecting diagnostics from all files...",
    );

    // Get ALL diagnostics from the workspace
    const allDiagnostics = vscode.languages.getDiagnostics();

    for (const [uri, diagnostics] of allDiagnostics) {
      const filePath = uri.fsPath;

      // Count only real errors (severity 0), not warnings
      const errorCount = diagnostics.filter(
        (d) => d.severity === vscode.DiagnosticSeverity.Error,
      ).length;

      if (errorCount > 0) {
        errorsByFile.set(filePath, errorCount);
        console.log(`   ❌ ${path.basename(filePath)}: ${errorCount} error(s)`);
      }
    }

    console.log(`\n📊 Total files with errors: ${errorsByFile.size}`);

    const roadmapFiles: RoadmapFile[] = [];

    for (const file of files) {
      const fileName = file.path.split(/[/\\]/).pop() || file.path;

      // Get functions for this specific file
      const fileFunctions = allFunctions.filter(
        (fn) => fn.filePath === file.path,
      );

      console.log(`\n   📄 ${fileName}: ${fileFunctions.length} functions`);

      if (fileFunctions.length === 0) {
        console.log(`      ⚠️  No functions - skipping`);
        continue;
      }

      const functions: RoadmapFunction[] = fileFunctions.map((fn) => {
        // Get outgoing calls from this function (across all files)
        const calls = allEdges
          .filter((edge) => edge.callerId === fn.id)
          .map((edge) => edge.calleeName);

        if (calls.length > 0) {
          console.log(`      ⚡ ${fn.name} → [${calls.join(", ")}]`);
        }

        return {
          name: fn.name,
          filePath: fn.filePath,
          emoji: this.getFunctionEmoji(fn.name),
          calls: calls,
          startLine: fn.startLine,
          endLine: fn.endLine,
        };
      });

      // ✅ Determine file color based on errors
      const errorCount = errorsByFile.get(file.path) || 0;
      const fileColor = errorCount > 0 ? "#ef4444" : "#3b82f6"; // Red if errors, blue otherwise

      console.log(
        `      ${errorCount > 0 ? "🔴" : "🔵"} Color: ${fileColor} (${errorCount} errors)`,
      );

      roadmapFiles.push({
        name: fileName,
        path: file.path,
        functions: functions,
        color: fileColor,
        errorCount: errorCount,
      });
    }

    const result: RoadmapData = {
      files: roadmapFiles,
      totalFiles: roadmapFiles.length,
      totalFunctions: roadmapFiles.reduce(
        (sum, f) => sum + f.functions.length,
        0,
      ),
      totalConnections: allEdges.length,
    };

    console.log("\n✅ [buildRoadmapData] Complete:");
    console.log(`   📁 Files with functions: ${result.totalFiles}`);
    console.log(`   ⚡ Total functions: ${result.totalFunctions}`);
    console.log(`   🔗 Total connections: ${result.totalConnections}`);

    // Show files with errors
    const filesWithErrors = roadmapFiles.filter(
      (f) => f.errorCount && f.errorCount > 0,
    );
    if (filesWithErrors.length > 0) {
      console.log(`\n   ❌ Files with errors: ${filesWithErrors.length}`);
      filesWithErrors.forEach((f) => {
        console.log(`      - ${f.name}: ${f.errorCount} error(s)`);
      });
    }

    // Debug: Show sample files
    if (roadmapFiles.length > 0) {
      console.log("\n📋 Sample files:");
      roadmapFiles.slice(0, 3).forEach((file) => {
        console.log(
          `   ${file.errorCount && file.errorCount > 0 ? "🔴" : "🔵"} ${file.name} (${file.errorCount || 0} errors):`,
        );
        file.functions.slice(0, 3).forEach((fn) => {
          console.log(`      - ${fn.name} (calls: ${fn.calls.length})`);
        });
      });
    }

    return result;
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
    .error-container {
      text-align: center;
      max-width: 500px;
    }
    .error-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .error-message {
      font-size: 16px;
      line-height: 1.5;
    }
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
    webview: vscode.Webview,
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
