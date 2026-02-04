import * as vscode from "vscode";
import { CodeTreeProvider } from "./providers/CodeTreeProvider";
import { CodeWebviewProvider } from "./providers/CodeWebviewProvider";
import { AuthWebviewProvider } from "./providers/AuthWebviewProvider";
import { AIProviderWebviewProvider } from "./providers/AIProviderWebviewProvider";
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
import { AIService } from "./services/aiService";
import { relevantFilesResolver } from "./services/relevantFilesResolver";
import { ErrorAnalyzer } from "./analyzers/debug/errorAnalyzer";
import * as path from "path";
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
          vscode.window.showWarningMessage("No functions found.");
          return;
        }

        vscode.window.showInformationMessage(
          `✓ Roadmap ready: ${fileCount} files, ${functionCount} functions`,
        );

        const panel = CodeWebviewProvider.showRoadmap(context);

        panel.webview.onDidReceiveMessage(
          async (message) => {
            console.log("📨 [CodeWebviewProvider] Received message:", message);

            // Existing goToFunction handler
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

                editor.selection = new vscode.Selection(
                  range.start,
                  range.start,
                );
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

                const decoration = vscode.window.createTextEditorDecorationType(
                  {
                    backgroundColor: new vscode.ThemeColor(
                      "editor.findMatchHighlightBackground",
                    ),
                    isWholeLine: true,
                  },
                );

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
                vscode.window.showErrorMessage(
                  `Failed to open file: ${errorMsg}`,
                );
              }
            }

            // Get error details
            if (message.command === "getErrorDetails") {
              try {
                const filePath = message.filePath;
                console.log(
                  `🔍 [getErrorDetails] Analyzing errors in: ${filePath}`,
                );

                const errors = ErrorAnalyzer.analyzeFileErrors(filePath);

                console.log(`   Found ${errors.length} errors`);
                errors.forEach((err) => {
                  console.log(
                    `   ❌ ${err.errorType}: ${err.message.substring(0, 50)}...`,
                  );
                });

                panel.webview.postMessage({
                  command: "displayErrorDetails",
                  errors: errors,
                });
              } catch (error) {
                const errorMsg =
                  error instanceof Error ? error.message : "Unknown error";
                console.error("❌ [getErrorDetails] Error:", errorMsg);
                vscode.window.showErrorMessage(
                  `Failed to analyze errors: ${errorMsg}`,
                );
              }
            }

            // ✅ ENHANCED: Show debug flow with import/export visualization
            if (message.command === "showDebugFlow") {
              try {
                const filePath = message.filePath;
                const functionName = message.functionName;

                console.log(
                  `🐞 [showDebugFlow] Building flow for: ${functionName} in ${filePath}`,
                );

                const errors = ErrorAnalyzer.analyzeFileErrors(filePath);
                const error = errors.find(
                  (e) => e.functionName === functionName,
                );

                if (!error) {
                  vscode.window.showWarningMessage(
                    `No error found in function ${functionName}`,
                  );
                  return;
                }

                const { nodes, edges } =
                  ErrorAnalyzer.buildErrorExecutionFlow(error);

                console.log(
                  `   Built flow: ${nodes.length} nodes, ${edges.length} edges`,
                );

                // ✅ ENHANCED: Build mermaid with color-coded nodes and edge types
                let mermaid = "graph TD\n";

                nodes.forEach((node) => {
                  let style = "";
                  let icon = "";

                  switch (node.type) {
                    case "error":
                      style = `style ${node.id} fill:#ef4444,stroke:#dc2626,color:#fff,stroke-width:3px`;
                      icon = "❌";
                      break;
                    case "function":
                      style = `style ${node.id} fill:#3b82f6,stroke:#2563eb,color:#fff`;
                      icon = "⚡";
                      break;
                    case "import":
                      style = `style ${node.id} fill:#8b5cf6,stroke:#7c3aed,color:#fff`;
                      icon = "📥";
                      break;
                    case "export":
                      style = `style ${node.id} fill:#10b981,stroke:#059669,color:#fff`;
                      icon = "📤";
                      break;
                    case "file":
                      style = `style ${node.id} fill:#f59e0b,stroke:#d97706,color:#fff`;
                      icon = "📄";
                      break;
                  }

                  mermaid += `  ${node.id}["${icon} ${node.label}"]\n`;
                  mermaid += `  ${style}\n`;
                });

                // ✅ ENHANCED: Different edge styles based on type
                edges.forEach((edge) => {
                  let edgeStyle = "";
                  let edgeLabel = edge.label;

                  switch (edge.edgeType) {
                    case "import":
                      edgeStyle = "-.->"; // Dotted line for imports
                      edgeLabel = `📥 ${edge.label}`;
                      break;
                    case "export":
                      edgeStyle = "==>"; // Thick line for exports
                      edgeLabel = `📤 ${edge.label}`;
                      break;
                    case "function-call":
                      edgeStyle = "-->"; // Regular arrow for function calls
                      edgeLabel = `⚡ ${edge.label}`;
                      break;
                    case "file-relation":
                      edgeStyle = "..>"; // Light dotted for file relations
                      edgeLabel = `📄 ${edge.label}`;
                      break;
                    default:
                      edgeStyle = "-->";
                  }

                  mermaid += `  ${edge.from} ${edgeStyle}|${edgeLabel}| ${edge.to}\n`;
                });

                // ✅ ENHANCED: Build detailed summary
                const summaryParts = [];

                if (
                  error.importDependencies &&
                  error.importDependencies.length > 0
                ) {
                  summaryParts.push(
                    `📥 Imports from ${error.importDependencies.length} files`,
                  );
                }

                if (
                  error.exportDependencies &&
                  error.exportDependencies.length > 0
                ) {
                  summaryParts.push(
                    `📤 Imported by ${error.exportDependencies.length} files`,
                  );
                }

                if (error.relatedFunctions.length > 0) {
                  summaryParts.push(
                    `⚡ ${error.relatedFunctions.length} function calls`,
                  );
                }

                const summary = `Debug Flow: ${error.errorType}\n\n${summaryParts.join(" • ")}`;

                CodeWebviewProvider.show(context, {
                  summary: summary,
                  errorText: error.message,
                  relevantCode: `Function: ${error.functionName}\nFile: ${error.fileName}\nLine: ${error.line}\n\nSuggestion: ${error.suggestion}`,
                  selectedCode: `
📥 IMPORTS FROM (${error.importDependencies?.length || 0} files):
${
  error.importDependencies
    ?.slice(0, 5)
    .map((f) => `  • ${path.basename(f)}`)
    .join("\n") || "  (none)"
}

📤 IMPORTED BY (${error.exportDependencies?.length || 0} files):
${
  error.exportDependencies
    ?.slice(0, 5)
    .map((f) => `  • ${path.basename(f)}`)
    .join("\n") || "  (none)"
}

⚡ FUNCTION CALLS (${error.relatedFunctions.length}):
${error.relatedFunctions.map((f) => `  • ${f}`).join("\n") || "  (none)"}

📄 RELATED FILES (${error.relatedFiles.length}):
${error.relatedFiles.map((f) => `  • ${path.basename(f)}`).join("\n") || "  (none)"}
      `.trim(),
                  mermaidDiagram: mermaid,
                });

                vscode.window.showInformationMessage(
                  `🐞 Debug flow: ${nodes.length} nodes, ${edges.length} connections`,
                );
              } catch (error) {
                const errorMsg =
                  error instanceof Error ? error.message : "Unknown error";
                console.error("❌ [showDebugFlow] Error:", errorMsg);
                vscode.window.showErrorMessage(
                  `Failed to build debug flow: ${errorMsg}`,
                );
              }
            }

            // Search function
            if (message.command === "searchFunction") {
              try {
                const functionName = message.functionName;
                console.log(
                  `🔍 [searchFunction] Searching for: ${functionName}`,
                );

                const func = functionIndex
                  .getAll()
                  .find((f) => f.name === functionName);

                if (func) {
                  const uri = vscode.Uri.file(func.filePath);
                  const document = await vscode.workspace.openTextDocument(uri);
                  const editor = await vscode.window.showTextDocument(
                    document,
                    vscode.ViewColumn.One,
                  );

                  const targetLine = Math.max(0, func.startLine - 1);
                  const range = new vscode.Range(targetLine, 0, targetLine, 0);

                  editor.selection = new vscode.Selection(
                    range.start,
                    range.start,
                  );
                  editor.revealRange(
                    range,
                    vscode.TextEditorRevealType.InCenter,
                  );

                  vscode.window.showInformationMessage(
                    `📍 Found ${functionName}`,
                  );
                } else {
                  vscode.window.showWarningMessage(
                    `Function ${functionName} not found`,
                  );
                }
              } catch (error) {
                const errorMsg =
                  error instanceof Error ? error.message : "Unknown error";
                console.error("❌ [searchFunction] Error:", errorMsg);
              }
            }
          },
          undefined,
          context.subscriptions,
        );
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
        const hasKey = await aiService.hasApiKey();
        if (!hasKey) {
          vscode.window.showErrorMessage(
            "API key тохируулаагүй. Sidebar-аас тохируулна уу.",
          );
          return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage("Файл нээнэ үү");
          return;
        }

        const files = await scanWorkspaceFiles();
        if (files.length > 0) {
          await loadWorkspaceFileContents(files);
          analyzeFunctionBoundaries(fileIndex.getAll());
          analyzeFunctionCalls(fileIndex.getAll());
        }

        const currentFilePath = editor.document.uri.fsPath;
        const relevantFiles =
          relevantFilesResolver.getRelevantFiles(currentFilePath);

        const relevantFilesWithContent = relevantFiles.map((rf) => {
          try {
            const indexedFile = fileIndex
              .getAll()
              .find((f) => f.path === rf.path);

            if (indexedFile) {
              return {
                path: rf.path,
                content: indexedFile.text,
              };
            }

            if (fs.existsSync(rf.path)) {
              const content = fs.readFileSync(rf.path, "utf-8");
              return {
                path: rf.path,
                content: content,
              };
            }

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

        const question = await vscode.window.showInputBox({
          prompt: `${providerName}-аас асуух`,
          placeHolder: "Энэ код юу хийдэг вэ?",
          ignoreFocusOut: true,
        });

        if (!question) return;

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
