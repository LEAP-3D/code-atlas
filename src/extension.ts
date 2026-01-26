import * as vscode from "vscode";
import { CodeTreeProvider } from "./providers/CodeTreeProvider";
import { CodeWebviewProvider } from "./providers/CodeWebviewProvider";
import { scanWorkspaceFiles } from "./analyzers/core/workspaceScanner";
import { fileIndex } from "./state/fileIndex";
import { functionIndex } from "./state/functionIndex";
import { triggerIndex } from "./state/triggerIndex";
import { buildExecutionMermaid } from "./analyzers/debug/executionMermaidBuilder";
import { loadWorkspaceFileContents } from "./analyzers/core/fileContentLoader";
import { analyzeFunctionBoundaries } from "./analyzers/core/functionBoundaryAnalyzer";
import { analyzeFunctionCalls } from "./analyzers/core/functionCallAnalyzer";
import { analyzeRuntimeTriggers } from "./analyzers/runtime/runtimeTriggerAnalyzer";
import { mapErrorsToFunctions } from "./analyzers/debug/errorFunctionMapper";
import { buildCallerChain } from "./analyzers/debug/executionChainBuilder";

export function activate(context: vscode.ExtensionContext) {
  const treeProvider = new CodeTreeProvider();
  vscode.window.registerTreeDataProvider("codeTree", treeProvider);

  // show selected code command (debug mode)
  const disposable = vscode.commands.registerCommand(
    "experiment.showSelectedCode",
    async () => {
      try {
        /* ---------- PHASE 1: scan workspace ---------- */
        vscode.window.showInformationMessage("Scanning workspace...");
        const files = await scanWorkspaceFiles();

        if (files.length === 0) {
          vscode.window.showWarningMessage(
            "No TypeScript files found in workspace"
          );
          return;
        }

        /* ---------- PHASE 2.1: load file contents ---------- */
        await loadWorkspaceFileContents(files);

        /* ---------- PHASE 2.2: analyze function boundaries ---------- */
        analyzeFunctionBoundaries(fileIndex.getAll());

        vscode.window.showInformationMessage(
          `✓ Indexed ${fileIndex.getAll().length} files`
        );

        vscode.window.showInformationMessage(
          `✓ Found ${functionIndex.getAll().length} functions`
        );

        /* ---------- PHASE 3: analyze function calls ---------- */
        analyzeFunctionCalls(fileIndex.getAll());

        /* ---------- PHASE 4A: analyze runtime triggers ---------- */
        analyzeRuntimeTriggers(fileIndex.getAll());

        /* ---------- ACTIVE EDITOR ---------- */
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage("No active editor");
          return;
        }

        const document = editor.document;

        /* ---------- PHASE 2.3 + 3 + 4A: error mapping + chain + trigger ---------- */
        const mappedErrors = mapErrorsToFunctions(document);

        mappedErrors.forEach((err) => {
          const chain = buildCallerChain(err.functionName, document.uri.fsPath);

          const trigger = triggerIndex.find(
            err.functionName,
            document.uri.fsPath
          );

          console.log(
            "[DEBUG] function:",
            err.functionName,
            "trigger:",
            trigger
          );

          vscode.window.showErrorMessage(
            `❌ ${chain.join(" → ")}: ${err.message}`
          );

          if (trigger) {
            vscode.window.showInformationMessage(
              `🔔 Triggered by: ${trigger.trigger}`
            );
          }
        });

        /* ---------- existing UI logic ---------- */
        const selectedCode =
          editor.selection && !editor.selection.isEmpty
            ? document.getText(editor.selection)
            : "No code selected";

        const errorFunctions = mappedErrors.map((e) => e.functionName);

        const mermaidDiagram = buildExecutionMermaid(
          document.uri.fsPath,
          errorFunctions
        );

        CodeWebviewProvider.show(context, {
          summary: "Workspace indexed",
          errorText: "N/A",
          relevantCode: "N/A",
          selectedCode,
          mermaidDiagram,
        });
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error during analysis: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
        console.error(error);
      }
    }
  );

  // show roadmap view command
  const roadmapDisposable = vscode.commands.registerCommand(
    "experiment.showRoadmap",
    async () => {
      try {
        vscode.window.showInformationMessage("🔍 Building project roadmap...");

        /* ---------- PHASE 1: scan workspace ---------- */
        const files = await scanWorkspaceFiles();

        if (files.length === 0) {
          vscode.window.showWarningMessage(
            "No TypeScript files found in workspace"
          );
          return;
        }

        /* ---------- PHASE 2: load and analyze ---------- */
        await loadWorkspaceFileContents(files);
        analyzeFunctionBoundaries(fileIndex.getAll());
        analyzeFunctionCalls(fileIndex.getAll());

        const fileCount = fileIndex.getAll().length;
        const functionCount = functionIndex.getAll().length;

        if (functionCount === 0) {
          vscode.window.showWarningMessage(
            "No functions found. Make sure you have TypeScript/JavaScript files with function declarations."
          );
          return;
        }

        vscode.window.showInformationMessage(
          `✓ Roadmap ready: ${fileCount} files, ${functionCount} functions`
        );

        /* ---------- SHOW ROADMAP ---------- */
        CodeWebviewProvider.showRoadmap(context);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error building roadmap: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
        console.error(error);
      }
    }
  );

  // register commands
  context.subscriptions.push(disposable);
  context.subscriptions.push(roadmapDisposable);
}
