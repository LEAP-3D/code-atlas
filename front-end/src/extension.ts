// front-end/src/extension.ts

import * as vscode from "vscode";
import { CodeTreeProvider } from "./providers/CodeTreeProvider";
import { CodeWebviewProvider } from "./providers/CodeWebviewProvider";
import { AuthWebviewProvider } from "./providers/AuthWebviewProvider";
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

// ===== ШИНЭ IMPORTS =====
import { ClaudeService } from "./services/claudeService";
import { relevantFilesResolver } from "./services/relevantFilesResolver";

export function activate(context: vscode.ExtensionContext) {
  // ============================================
  // CLAUDE SERVICE SETUP
  // ============================================
  const claudeService = new ClaudeService(context);

  // ============================================
  // SETUP USER WEBVIEW (AUTHENTICATION + HISTORY)
  // ============================================
  const authWebviewProvider = new AuthWebviewProvider(
    context.extensionUri,
    context,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AuthWebviewProvider.viewType,
      authWebviewProvider,
    ),
  );

  // ============================================
  // Existing code tree
  // ============================================
  const treeProvider = new CodeTreeProvider();
  vscode.window.registerTreeDataProvider("codeTree", treeProvider);

  // ============================================
  // show selected code command (debug mode)
  // ============================================
  const disposable = vscode.commands.registerCommand(
    "experiment.showSelectedCode",
    async () => {
      try {
        vscode.window.showInformationMessage("Scanning workspace...");
        const files = await scanWorkspaceFiles();

        if (files.length === 0) {
          vscode.window.showWarningMessage(
            "No TypeScript files found in workspace",
          );
          return;
        }

        await loadWorkspaceFileContents(files);
        analyzeFunctionBoundaries(fileIndex.getAll());

        vscode.window.showInformationMessage(
          `✓ Indexed ${fileIndex.getAll().length} files`,
        );
        vscode.window.showInformationMessage(
          `✓ Found ${functionIndex.getAll().length} functions`,
        );

        analyzeFunctionCalls(fileIndex.getAll());
        analyzeRuntimeTriggers(fileIndex.getAll());

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage("No active editor");
          return;
        }

        const document = editor.document;
        const mappedErrors = mapErrorsToFunctions(document);

        mappedErrors.forEach((err) => {
          const chain = buildCallerChain(err.functionName, document.uri.fsPath);
          const trigger = triggerIndex.find(
            err.functionName,
            document.uri.fsPath,
          );

          console.log(
            "[DEBUG] function:",
            err.functionName,
            "trigger:",
            trigger,
          );

          vscode.window.showErrorMessage(
            `❌ ${chain.join(" → ")}: ${err.message}`,
          );

          if (trigger) {
            vscode.window.showInformationMessage(
              `🔔 Triggered by: ${trigger.trigger}`,
            );
          }
        });

        const selectedCode =
          editor.selection && !editor.selection.isEmpty
            ? document.getText(editor.selection)
            : "No code selected";

        const errorFunctions = mappedErrors.map((e) => e.functionName);
        const mermaidDiagram = buildExecutionMermaid(
          document.uri.fsPath,
          errorFunctions,
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
          }`,
        );
        console.error(error);
      }
    },
  );

  // ============================================
  // show roadmap view command
  // ============================================
  const roadmapDisposable = vscode.commands.registerCommand(
    "experiment.showRoadmap",
    async () => {
      try {
        vscode.window.showInformationMessage("🔍 Building project roadmap...");

        const files = await scanWorkspaceFiles();

        if (files.length === 0) {
          vscode.window.showWarningMessage(
            "No TypeScript files found in workspace",
          );
          return;
        }

        await loadWorkspaceFileContents(files);
        analyzeFunctionBoundaries(fileIndex.getAll());
        analyzeFunctionCalls(fileIndex.getAll());

        const fileCount = fileIndex.getAll().length;
        const functionCount = functionIndex.getAll().length;

        if (functionCount === 0) {
          vscode.window.showWarningMessage(
            "No functions found. Make sure you have TypeScript/JavaScript files with function declarations.",
          );
          return;
        }

        vscode.window.showInformationMessage(
          `✓ Roadmap ready: ${fileCount} files, ${functionCount} functions`,
        );

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

  // ============================================
  // ASK CLAUDE COMMAND - ШИНЭ!
  // ============================================
  const askClaudeDisposable = vscode.commands.registerCommand(
    "experiment.askClaude",
    async () => {
      try {
        // 1. Claude initialize
        if (!claudeService.isInitialized()) {
          const success = await claudeService.initialize();
          if (!success) {
            vscode.window.showErrorMessage("Claude API key шаардлагатай");
            return;
          }
        }

        // 2. Active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage("Файл нээнэ үү");
          return;
        }

        // 3. Workspace scan
        const files = await scanWorkspaceFiles();
        if (files.length > 0) {
          await loadWorkspaceFileContents(files);
          analyzeFunctionBoundaries(fileIndex.getAll());
          analyzeFunctionCalls(fileIndex.getAll());
        }

        // 4. Graph-аас relevant files олох
        const currentFilePath = editor.document.uri.fsPath;
        const relevantFiles =
          relevantFilesResolver.getRelevantFiles(currentFilePath);

        vscode.window.showInformationMessage(
          `📁 ${relevantFiles.length} холбогдох файл олдлоо`,
        );

        // 5. Асуулт авах
        const question = await vscode.window.showInputBox({
          prompt: "Claude-аас юу асуух вэ?",
          placeHolder: "Энэ код юу хийдэг вэ?",
          ignoreFocusOut: true,
        });

        if (!question) return;

        // 6. Claude руу илгээх (loading-тэй)
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Claude хариулж байна...",
            cancellable: false,
          },
          async () => {
            const answer = await claudeService.askWithContext(
              relevantFiles,
              question,
            );

            // 7. Хариуг харуулах
            const doc = await vscode.workspace.openTextDocument({
              content: `# Claude Хариулт\n\n**Асуулт:** ${question}\n\n**Контекст:** ${relevantFiles.length} файл илгээгдсэн\n- ${relevantFiles.map((f) => f.path).join("\n- ")}\n\n---\n\n${answer}`,
              language: "markdown",
            });
            await vscode.window.showTextDocument(doc, { preview: true });
          },
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Claude алдаа: ${error instanceof Error ? error.message : "Unknown"}`,
        );
        console.error(error);
      }
    },
  );

  // ============================================
  // CLEAR CLAUDE API KEY COMMAND
  // ============================================
  const clearApiKeyDisposable = vscode.commands.registerCommand(
    "experiment.clearClaudeApiKey",
    async () => {
      await claudeService.clearApiKey();
      vscode.window.showInformationMessage(
        "✓ Claude API key устгагдлаа. Дахин оруулна уу.",
      );
    },
  );

  context.subscriptions.push(clearApiKeyDisposable);

  // ============================================
  // REGISTER ALL COMMANDS
  // ============================================
  context.subscriptions.push(disposable);
  context.subscriptions.push(roadmapDisposable);
  context.subscriptions.push(askClaudeDisposable);
}

export function deactivate() {
  console.log("Extension deactivated");
}
