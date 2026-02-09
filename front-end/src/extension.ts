import * as vscode from "vscode";
import { CodeTreeProvider } from "./providers/CodeTreeProvider";
import { CodeWebviewProvider } from "./providers/CodeWebviewProvider";
import { AuthWebviewProvider } from "./providers/AuthWebviewProvider";
import { AIProviderWebviewProvider } from "./providers/AIProviderWebviewProvider";
import { scanWorkspaceFiles } from "./analyzers/core/workspaceScanner";
import { fileIndex } from "./state/fileIndex";
import { functionIndex } from "./state/functionIndex";
import { triggerIndex } from "./state/triggerIndex";
import { dependencyIndex } from "./state/dependencyIndex"; // ✅ ШИНЭ
import { buildExecutionMermaid } from "./analyzers/debug/executionMermaidBuilder";
import { loadWorkspaceFileContents } from "./analyzers/core/fileContentLoader";
import { analyzeFunctionBoundaries } from "./analyzers/core/functionBoundaryAnalyzer";
import { analyzeFunctionCalls } from "./analyzers/core/functionCallAnalyzer";
import { analyzeRuntimeTriggers } from "./analyzers/runtime/runtimeTriggerAnalyzer";
import { analyzeImportDependencies } from "./analyzers/dependencies/importDependencyAnalyzer"; // ✅ ШИНЭ
import { mapErrorsToFunctions } from "./analyzers/debug/errorFunctionMapper";
import { buildCallerChain } from "./analyzers/debug/executionChainBuilder";
import { AIService } from "./services/aiService";
import { relevantFilesResolver } from "./services/relevantFilesResolver";
import * as fs from "fs";

export function activate(context: vscode.ExtensionContext) {
  // ============================================
  // AI SERVICE SETUP
  // ============================================
  const aiService = new AIService(context);

  // ============================================
  // AI PROVIDER WEBVIEW (SIDEBAR)
  // ============================================
  const aiProviderWebviewProvider = new AIProviderWebviewProvider(
    context.extensionUri,
    context,
    aiService,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AIProviderWebviewProvider.viewType,
      aiProviderWebviewProvider,
    ),
  );

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
  // const treeProvider = new CodeTreeProvider();
  // vscode.window.registerTreeDataProvider("codeTree", treeProvider);
   const treeProvider = new CodeTreeProvider();
  const treeDisposable = vscode.window.registerTreeDataProvider("codeTree", treeProvider);
  context.subscriptions.push(treeDisposable);
  
  console.log("✅ CodeTreeProvider registered");

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
        
        // ✅ ШИНЭ: Import dependencies шинжлэх
        analyzeImportDependencies(fileIndex.getAll());

        const fileCount = fileIndex.getAll().length;
        const functionCount = functionIndex.getAll().length;
        const dependencyCount = dependencyIndex.getAll().length; // ✅ ШИНЭ

        if (functionCount === 0) {
          vscode.window.showWarningMessage("No functions found.");
          return;
        }

        // ✅ ШИНЭ: Dependencies тоог харуулах
        vscode.window.showInformationMessage(
          `✓ Roadmap ready: ${fileCount} files, ${functionCount} functions, ${dependencyCount} imports`,
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
  // ASK AI COMMAND
  // ============================================
  const askAIDisposable = vscode.commands.registerCommand(
    "experiment.askAI",
    async () => {
      try {
        // 1. API key шалгах
        const hasKey = await aiService.hasApiKey();
        if (!hasKey) {
          vscode.window.showErrorMessage(
            "API key тохируулаагүй. Sidebar-аас тохируулна уу.",
          );
          return;
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

        // ✅ ЗАСВАР: Файлын агуулгыг нэмж өгөх
        const relevantFilesWithContent = relevantFiles.map((rf) => {
          try {
            // fileIndex-ээс авах оролдлого
            const indexedFile = fileIndex
              .getAll()
              .find((f) => f.path === rf.path);

            if (indexedFile) {
              return {
                path: rf.path,
                content: indexedFile.text,
              };
            }

            // fileIndex дээр олдохгүй бол файлаас шууд уншиж авах
            if (fs.existsSync(rf.path)) {
              const content = fs.readFileSync(rf.path, "utf-8");
              return {
                path: rf.path,
                content: content,
              };
            }

            // Файл олдохгүй бол хоосон агуулга өгөх
            console.warn(`⚠️ File not found: ${rf.path}`);
            return {
              path: rf.path,
              content: `// File not found: ${rf.path}`,
            };
          } catch (error) {
            console.error(`Error reading file ${rf.path}:`, error);
            return {
              path: rf.path,
              content: `// Error reading file: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
          }
        });

        const providerName = aiService.getProviderConfig().name;
        vscode.window.showInformationMessage(
          `📁 ${relevantFilesWithContent.length} файл → ${providerName}`,
        );

        // 5. Асуулт авах
        const question = await vscode.window.showInputBox({
          prompt: `${providerName}-аас асуух`,
          placeHolder: "Энэ код юу хийдэг вэ?",
          ignoreFocusOut: true,
        });

        if (!question) return;

        // 6. AI руу илгээх
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `${providerName} хариулж байна...`,
            cancellable: false,
          },
          async () => {
            const answer = await aiService.askWithContext(
              relevantFilesWithContent,
              question,
            );

            // 7. Хариуг харуулах
            const doc = await vscode.workspace.openTextDocument({
              content: `# ${providerName} Хариулт\n\n**Асуулт:** ${question}\n\n**Контекст:** ${relevantFilesWithContent.length} файл\n- ${relevantFilesWithContent.map((f) => f.path).join("\n- ")}\n\n---\n\n${answer}`,
              language: "markdown",
            });
            await vscode.window.showTextDocument(doc, { preview: true });
          },
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `AI алдаа: ${error instanceof Error ? error.message : "Unknown"}`,
        );
        console.error(error);
      }
    },
  );

  // ============================================
  // REGISTER ALL COMMANDS
  // ============================================
  context.subscriptions.push(disposable);
  context.subscriptions.push(roadmapDisposable);
  context.subscriptions.push(askAIDisposable);
}

export function deactivate() {
  console.log("Extension deactivated");
}