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

  // NEW: Show error dependency graph
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

        if (message.command === "openFile") {
          try {
            const filePath = message.filePath;
            console.log(`📂 Opening file: ${filePath}`);

            if (!fs.existsSync(filePath)) {
              throw new Error(`File not found: ${filePath}`);
            }

            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(
              document,
              vscode.ViewColumn.One,
            );

            vscode.window.showInformationMessage(
              `📂 Opened ${path.basename(filePath)}`,
            );
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            vscode.window.showErrorMessage(`Failed to open file: ${errorMsg}`);
          }
        } else if (message.command === "goToLine") {
          try {
            const filePath = message.filePath;
            const line = message.line || 1;

            console.log(`🎯 Going to ${filePath}:${line}`);

            if (!fs.existsSync(filePath)) {
              throw new Error(`File not found: ${filePath}`);
            }

            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(
              document,
              vscode.ViewColumn.One,
            );

            const targetLine = Math.max(0, line - 1);
            const range = new vscode.Range(targetLine, 0, targetLine, 0);

            editor.selection = new vscode.Selection(range.start, range.start);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

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

            vscode.window.showInformationMessage(`🎯 Jumped to line ${line}`);
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            vscode.window.showErrorMessage(`Failed to go to line: ${errorMsg}`);
          }
        } else if (message.command === "showAllErrors") {
          try {
            const errors = message.errors || [];

            if (errors.length === 0) {
              vscode.window.showInformationMessage("No errors found");
              return;
            }

            // Show errors in Problems panel
            vscode.window.showInformationMessage(
              `📋 ${errors.length} error(s) in Problems panel`,
            );

            // Execute "View: Show Problems" command
            await vscode.commands.executeCommand(
              "workbench.action.problems.focus",
            );
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            vscode.window.showErrorMessage(
              `Failed to show errors: ${errorMsg}`,
            );
          }
        } else if (message.command === "copyFile") {
          try {
            const filePath = message.filePath;
            console.log(`📋 Copying file: ${filePath}`);

            if (!fs.existsSync(filePath)) {
              throw new Error(`File not found: ${filePath}`);
            }

            const content = fs.readFileSync(filePath, "utf-8");
            await vscode.env.clipboard.writeText(content);

            const fileName = path.basename(filePath);
            vscode.window.showInformationMessage(
              `📋 Copied ${fileName} to clipboard`,
            );
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            vscode.window.showErrorMessage(`Failed to copy file: ${errorMsg}`);
          }
        } else if (message.command === "copyAllFiles") {
          try {
            const files = message.files || [];
            console.log(`📋 Copying ${files.length} files`);

            if (files.length === 0) {
              vscode.window.showWarningMessage("No files to copy");
              return;
            }

            let combinedContent = "";
            let successCount = 0;

            for (let i = 0; i < files.length; i++) {
              const filePath = files[i];

              try {
                if (!fs.existsSync(filePath)) {
                  console.warn(`⚠️ File not found: ${filePath}`);
                  continue;
                }

                const fileName = path.basename(filePath);
                const content = fs.readFileSync(filePath, "utf-8");

                // Add file header with separator
                combinedContent += `// ========================================\n`;
                combinedContent += `// File: ${fileName}\n`;
                combinedContent += `// Path: ${filePath}\n`;
                combinedContent += `// ========================================\n\n`;
                combinedContent += content;

                // Add 1 line spacing between files
                if (i < files.length - 1) {
                  combinedContent += "\n\n";
                }

                successCount++;
              } catch (error) {
                console.error(`Error reading ${filePath}:`, error);
              }
            }

            if (successCount === 0) {
              throw new Error("No files could be read");
            }

            await vscode.env.clipboard.writeText(combinedContent);

            vscode.window.showInformationMessage(
              `📋 Copied ${successCount} file${successCount > 1 ? "s" : ""} to clipboard!`,
            );
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            vscode.window.showErrorMessage(`Failed to copy files: ${errorMsg}`);
          }
        }
      },
      undefined,
      context.subscriptions,
    );
  }

  private static getErrorGraphHtml(
    webview: vscode.Webview,
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
      // Build error graph data
      const errorGraphData = this.buildErrorGraphData(errorFilePath);

      console.log("🐛 [getErrorGraphHtml] Injecting error graph data");
      console.log(`   Error file: ${errorFilePath}`);
      console.log(`   Errors: ${errorGraphData.errors.length}`);
      console.log(`   Dependencies: ${errorGraphData.dependencies.length}`);
      console.log(`   Related files: ${errorGraphData.allFiles.length}`);

      // Inject data as JSON
      const dataScript = `<script>window.ERROR_GRAPH_DATA = ${JSON.stringify(
        errorGraphData,
        null,
        2,
      )};</script>`;

      // Insert before </head>
      html = html.replace("</head>", `${dataScript}\n</head>`);

      return html;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("❌ [getErrorGraphHtml] Error building graph:", errorMsg);
      return this.getErrorHtml(`Error building dependency graph: ${errorMsg}`);
    }
  }

  private static buildErrorGraphData(errorFilePath: string) {
    console.log("🔨 [buildErrorGraphData] Building error graph...");
    console.log(`   Error file: ${errorFilePath}`);

    // Get all diagnostics for error file
    const uri = vscode.Uri.file(errorFilePath);
    const diagnostics = vscode.languages.getDiagnostics(uri);

    const errors = diagnostics
      .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
      .map((d) => ({
        line: d.range.start.line + 1,
        message: d.message,
        severity: d.severity,
      }));

    console.log(`   Found ${errors.length} errors`);

    // Get all dependencies
    const allDependencies = dependencyIndex.getAll();
    console.log(`   Total dependencies in index: ${allDependencies.length}`);

    // Filter dependencies related to error file
    const relatedDependencies = allDependencies.filter(
      (dep) =>
        dep.importerFilePath === errorFilePath ||
        dep.importedFilePath === errorFilePath,
    );

    console.log(`   Related dependencies: ${relatedDependencies.length}`);

    // Get all unique files
    const relatedFilePaths = new Set<string>();
    relatedFilePaths.add(errorFilePath);

    relatedDependencies.forEach((dep) => {
      relatedFilePaths.add(dep.importerFilePath);
      relatedFilePaths.add(dep.importedFilePath);
    });

    console.log(`   Related files: ${relatedFilePaths.size}`);

    // Get file details for all related files
    const allFiles = Array.from(relatedFilePaths)
      .map((filePath) => {
        const _fileData = fileIndex.getAll().find((f) => f.path === filePath);
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
      })
      .filter((f) => f !== null);

    console.log(`   Processed ${allFiles.length} files with details`);

    return {
      errorFile: errorFilePath,
      errors: errors,
      dependencies: relatedDependencies,
      allFiles: allFiles,
    };
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

            if (!fs.existsSync(filePath)) {
              throw new Error(`File not found: ${filePath}`);
            }

            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(
              document,
              vscode.ViewColumn.One,
            );

            const targetLine = Math.max(0, line - 1);
            const range = new vscode.Range(targetLine, 0, targetLine, 0);

            editor.selection = new vscode.Selection(range.start, range.start);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

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
        } else if (message.command === "debugExecutionFlow") {
          try {
            const filePath = message.filePath;
            console.log(`🐛 [debugExecutionFlow] Analyzing: ${filePath}`);

            // Show error dependency graph instead
            this.showErrorDependencyGraph(context, filePath);
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            console.error("❌ [debugExecutionFlow] Error:", errorMsg);
            vscode.window.showErrorMessage(
              `Failed to show dependency graph: ${errorMsg}`,
            );
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
      const roadmapData = this.buildRoadmapData();

      console.log("📊 [getRoadmapHtml] Injecting roadmap data");
      console.log(`   Files: ${roadmapData.totalFiles}`);
      console.log(`   Functions: ${roadmapData.totalFunctions}`);
      console.log(`   Connections: ${roadmapData.totalConnections}`);
      console.log(`   Dependencies: ${roadmapData.dependencies.length}`);

      const dataScript = `<script>window.ROADMAP_DATA = ${JSON.stringify(
        roadmapData,
        null,
        2,
      )};</script>`;

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
    const allDependencies = dependencyIndex.getAll();

    console.log(`   📂 Files indexed: ${files.length}`);
    console.log(`   ⚡ Functions indexed: ${allFunctions.length}`);
    console.log(`   🔗 Call edges: ${allEdges.length}`);
    console.log(`   📦 Dependencies: ${allDependencies.length}`);

    if (files.length === 0) {
      console.warn("⚠️ No files indexed!");
      return {
        files: [],
        dependencies: [],
        totalFiles: 0,
        totalFunctions: 0,
        totalConnections: 0,
      };
    }

    const errorsByFile = new Map<string, number>();

    console.log(
      "\n🔍 [buildRoadmapData] Collecting diagnostics from all files...",
    );

    const allDiagnostics = vscode.languages.getDiagnostics();

    for (const [uri, diagnostics] of allDiagnostics) {
      const filePath = uri.fsPath;

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

      const fileFunctions = allFunctions.filter(
        (fn) => fn.filePath === file.path,
      );

      console.log(`\n   📄 ${fileName}: ${fileFunctions.length} functions`);

      if (fileFunctions.length === 0) {
        console.log(`      ⚠️ No functions - skipping`);
        continue;
      }

      const functions: RoadmapFunction[] = fileFunctions.map((fn) => {
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

      const errorCount = errorsByFile.get(file.path) || 0;
      const fileColor = errorCount > 0 ? "#ef4444" : "#3b82f6";

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

    const dependenciesForFrontend: RoadmapDependency[] = allDependencies.map(
      (dep) => ({
        importerFilePath: dep.importerFilePath,
        importedFilePath: dep.importedFilePath,
        importedNames: dep.importedNames,
        importPath: dep.importPath,
      }),
    );

    const result: RoadmapData = {
      files: roadmapFiles,
      dependencies: dependenciesForFrontend,
      totalFiles: roadmapFiles.length,
      totalFunctions: roadmapFiles.reduce(
        (sum, f) => sum + f.functions.length,
        0,
      ),
      totalConnections: allEdges.length,
    };

    console.log("\n✅ [buildRoadmapData] Complete:");
    console.log(`   📂 Files with functions: ${result.totalFiles}`);
    console.log(`   ⚡ Total functions: ${result.totalFunctions}`);
    console.log(`   🔗 Total connections: ${result.totalConnections}`);
    console.log(`   📦 Total dependencies: ${dependenciesForFrontend.length}`);

    const filesWithErrors = roadmapFiles.filter(
      (f) => f.errorCount && f.errorCount > 0,
    );
    if (filesWithErrors.length > 0) {
      console.log(`\n   ❌ Files with errors: ${filesWithErrors.length}`);
      filesWithErrors.forEach((f) => {
        console.log(`      - ${f.name}: ${f.errorCount} error(s)`);
      });
    }

    if (dependenciesForFrontend.length > 0) {
      console.log("\n📦 Sample dependencies:");
      dependenciesForFrontend.slice(0, 3).forEach((dep) => {
        const importerName = dep.importerFilePath.split(/[/\\]/).pop();
        const importedName = dep.importedFilePath.split(/[/\\]/).pop();
        console.log(
          `   ${importerName} imports [${dep.importedNames.join(", ")}] from ${importedName}`,
        );
      });
    }

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
