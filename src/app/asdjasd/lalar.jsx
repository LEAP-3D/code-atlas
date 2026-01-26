import * as vscode from "vscode";
import { CodeTreeProvider } from "./providers/CodeTreeProvider";
import { CodeWebviewProvider } from "./providers/CodeWebviewProvider";
import { runFullAnalysis } from "./orchestration/AnalysisOrchestrator";

export function activate(context: vscode.ExtensionContext) {
  /* ---------- TREE VIEW ---------- */
  const treeProvider = new CodeTreeProvider();
  vscode.window.registerTreeDataProvider("codeTree", treeProvider);

  /* ---------- COMMAND: SHOW SELECTED CODE ---------- */
  const disposable = vscode.commands.registerCommand(
    "experiment.showSelectedCode",
    async () => {
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage("No active editor");
          return;
        }

        vscode.window.showInformationMessage("🔍 Analyzing workspace...");

        /* ---------- RUN FULL ANALYSIS ---------- */
        const result = await runFullAnalysis(editor.document);

        /* ---------- SELECTED CODE ---------- */
        const document = editor.document;
        const selectedCode =
          editor.selection && !editor.selection.isEmpty
            ? document.getText(editor.selection)
            : "No code selected";

        /* ---------- SHOW WEBVIEW ---------- */
        CodeWebviewProvider.show(context, {
          summary: "Workspace indexed successfully",
          errorText:
            result.errors && result.errors.length > 0
              ? result.errors
                  .map(
                    (e) =>
                      `❌ ${e.callerChain?.join(" → ") ?? e.functionName}: ${
                        e.message
                      }`,
                  )
                  .join("\n")
              : "No errors detected",
          relevantCode: "N/A",
          selectedCode,
          mermaidDiagram: result.mermaid ?? "graph TD;\nA[No Data]",
        });
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error during analysis: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
        console.error(error);
      }
    },
  );

  /* ---------- COMMAND: SHOW ROADMAP ---------- */
  const roadmapDisposable = vscode.commands.registerCommand(
    "experiment.showRoadmap",
    async () => {
      try {
        vscode.window.showInformationMessage("🗺 Building project roadmap...");

        // Roadmap-д document шаардлагагүй
        await runFullAnalysis();

        CodeWebviewProvider.showRoadmap(context);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error building roadmap: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
        console.error(error);
      }
    },
  );

  /* ---------- REGISTER ---------- */
  context.subscriptions.push(disposable, roadmapDisposable);
}
