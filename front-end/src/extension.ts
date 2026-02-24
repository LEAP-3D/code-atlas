import * as vscode from "vscode";
import { CodeTreeProvider } from "./providers/CodeTreeProvider";
import { CodeWebviewProvider } from "./providers/CodeWebviewProvider";
import { AuthWebviewProvider } from "./providers/AuthWebviewProvider";
// import { AIProviderWebviewProvider } from "./providers/AIProviderWebviewProvider";
import { scanWorkspaceFiles } from "./analyzers/core/workspaceScanner";
import { fileIndex } from "./state/fileIndex";
import { functionIndex } from "./state/functionIndex";
import { triggerIndex } from "./state/triggerIndex";
import { dependencyIndex } from "./state/dependencyIndex"; // ✅ ШИНЭ
import { callGraphIndex } from "./state/callGraphIndex";
import { buildExecutionMermaid } from "./analyzers/debug/executionMermaidBuilder";
import { loadWorkspaceFileContents } from "./analyzers/core/fileContentLoader";
import { analyzeFunctionBoundaries } from "./analyzers/core/functionBoundaryAnalyzer";
import { analyzeFunctionCalls } from "./analyzers/core/functionCallAnalyzer";
import { analyzeRuntimeTriggers } from "./analyzers/runtime/runtimeTriggerAnalyzer";
import { analyzeImportDependencies } from "./analyzers/dependencies/importDependencyAnalyzer"; // ✅ ШИНЭ
import { mapErrorsToFunctions } from "./analyzers/debug/errorFunctionMapper";
import { buildCallerChain } from "./analyzers/debug/executionChainBuilder";
// import { AIService } from "./services/aiService";
// import { relevantFilesResolver } from "./services/relevantFilesResolver";
// import * as fs from "fs";

const MONOREPO_MARKERS = [
  "pnpm-workspace.yaml",
  "nx.json",
  "turbo.json",
  "lerna.json",
] as const;
const MONOREPO_PROJECT_CONTAINERS = ["apps", "packages", "services"] as const;
const PROJECT_MANIFESTS = ["package.json"] as const;
const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  "coverage",
]);

type MonorepoProjectCandidate = {
  label: string;
  description: string;
  uri: vscode.Uri;
  hasActiveFile: boolean;
};

async function fileExistsAtRoot(workspaceUri: vscode.Uri, fileName: string) {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(workspaceUri, fileName));
    return true;
  } catch {
    return false;
  }
}

async function packageJsonHasWorkspaces(workspaceUri: vscode.Uri) {
  try {
    const packageJsonUri = vscode.Uri.joinPath(workspaceUri, "package.json");
    const bytes = await vscode.workspace.fs.readFile(packageJsonUri);
    const raw = new TextDecoder().decode(bytes);
    const pkg = JSON.parse(raw) as { workspaces?: unknown };
    return Boolean(pkg.workspaces);
  } catch {
    return false;
  }
}

async function isMonorepoFast(workspaceFolder: vscode.WorkspaceFolder) {
  for (const marker of MONOREPO_MARKERS) {
    if (await fileExistsAtRoot(workspaceFolder.uri, marker)) {
      return true;
    }
  }

  return packageJsonHasWorkspaces(workspaceFolder.uri);
}

async function directoryExists(uri: vscode.Uri) {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return stat.type === vscode.FileType.Directory;
  } catch {
    return false;
  }
}

async function hasAnyManifest(projectUri: vscode.Uri) {
  for (const manifest of PROJECT_MANIFESTS) {
    if (await fileExistsAtRoot(projectUri, manifest)) {
      return true;
    }
  }
  return false;
}

async function readDirectorySafe(uri: vscode.Uri) {
  try {
    return await vscode.workspace.fs.readDirectory(uri);
  } catch {
    return [];
  }
}

async function discoverMonorepoProjectsShallow(
  workspaceFolder: vscode.WorkspaceFolder,
): Promise<MonorepoProjectCandidate[]> {
  const activeFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
  const candidates = new Map<string, MonorepoProjectCandidate>();

  const maybeAddCandidate = async (projectUri: vscode.Uri, label: string) => {
    if (!(await directoryExists(projectUri))) return;
    if (!(await hasAnyManifest(projectUri))) return;

    const hasActiveFile = activeFilePath
      ? activeFilePath.startsWith(projectUri.fsPath)
      : false;

    candidates.set(projectUri.fsPath, {
      label,
      description: projectUri.fsPath,
      uri: projectUri,
      hasActiveFile,
    });
  };

  for (const container of MONOREPO_PROJECT_CONTAINERS) {
    const containerUri = vscode.Uri.joinPath(workspaceFolder.uri, container);
    if (!(await directoryExists(containerUri))) continue;

    const entries = await readDirectorySafe(containerUri);
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) continue;
      if (name.startsWith(".") || IGNORED_DIR_NAMES.has(name)) continue;

      await maybeAddCandidate(
        vscode.Uri.joinPath(containerUri, name),
        `${container}/${name}`,
      );
    }
  }

  if (candidates.size === 0) {
    const rootEntries = await readDirectorySafe(workspaceFolder.uri);
    for (const [name, type] of rootEntries) {
      if (type !== vscode.FileType.Directory) continue;
      if (name.startsWith(".") || IGNORED_DIR_NAMES.has(name)) continue;

      await maybeAddCandidate(vscode.Uri.joinPath(workspaceFolder.uri, name), name);
    }
  }

  return Array.from(candidates.values()).sort((a, b) => {
    if (a.hasActiveFile !== b.hasActiveFile) return a.hasActiveFile ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

async function pickMonorepoProject(
  workspaceFolder: vscode.WorkspaceFolder,
): Promise<vscode.Uri | undefined> {
  const candidates = await discoverMonorepoProjectsShallow(workspaceFolder);

  if (candidates.length === 0) {
    vscode.window.showWarningMessage(
      `Monorepo detected in "${workspaceFolder.name}", but no projects were found under apps/, packages/, or services/.`,
    );
    return undefined;
  }

  const selection = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({
      label: candidate.hasActiveFile
        ? `$(star-full) ${candidate.label}`
        : candidate.label,
      description: candidate.hasActiveFile
        ? "Contains current file"
        : undefined,
      detail: candidate.description,
      candidate,
    })),
    {
      title: "Pick a project to analyze",
      placeHolder: "Select a monorepo project (shallow scan only)",
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );

  return selection?.candidate.uri;
}

function clearAnalysisIndexes() {
  fileIndex.clear();
  functionIndex.clear();
  dependencyIndex.clear();
  callGraphIndex.clear();
  triggerIndex.clear();
}

async function buildRoadmapForScope(
  context: vscode.ExtensionContext,
  scopeUri: vscode.Uri,
  label: string,
) {
  vscode.window.showInformationMessage(`🔍 Building roadmap for ${label}...`);

  clearAnalysisIndexes();

  const files = await scanWorkspaceFiles(scopeUri);

  if (files.length === 0) {
    vscode.window.showWarningMessage(
      "No TypeScript/JavaScript files found in selected project",
    );
    return;
  }

  await loadWorkspaceFileContents(files);
  analyzeFunctionBoundaries(fileIndex.getAll());
  analyzeFunctionCalls(fileIndex.getAll());
  analyzeImportDependencies(fileIndex.getAll());

  const fileCount = fileIndex.getAll().length;
  const functionCount = functionIndex.getAll().length;
  const dependencyCount = dependencyIndex.getAll().length;

  if (functionCount === 0) {
    vscode.window.showWarningMessage(
      "No functions found in selected project. Showing file/import roadmap only.",
    );
  }

  vscode.window.showInformationMessage(
    `✓ Roadmap ready (${label}): ${fileCount} files, ${functionCount} functions, ${dependencyCount} imports`,
  );

  CodeWebviewProvider.showRoadmap(context);
  await CodeWebviewProvider.refreshRoadmapPanelFromIndexes();
}

async function runMonorepoProjectPickerFlow(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const monorepoFolder = await (async () => {
    for (const folder of workspaceFolders) {
      if (await isMonorepoFast(folder)) return folder;
    }
    return undefined;
  })();

  if (!monorepoFolder) {
    vscode.window.showWarningMessage("No monorepo workspace detected.");
    return;
  }

  const selectedProjectUri = await pickMonorepoProject(monorepoFolder);
  if (!selectedProjectUri) {
    return;
  }

  await buildRoadmapForScope(
    context,
    selectedProjectUri,
    vscode.workspace.asRelativePath(selectedProjectUri),
  );
}

export function activate(context: vscode.ExtensionContext) {
  // ============================================
  // AI SERVICE SETUP
  // ============================================
  // const aiService = new AIService(context);

  // ============================================
  // AI PROVIDER WEBVIEW (SIDEBAR)
  // ============================================
  // const aiProviderWebviewProvider = new AIProviderWebviewProvider(
  //   context.extensionUri,
  //   context,
  //   aiService,
  // );

  // context.subscriptions.push(
  //   vscode.window.registerWebviewViewProvider(
  //     AIProviderWebviewProvider.viewType,
  //     aiProviderWebviewProvider,
  //   ),
  // );

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
  const treeDisposable = vscode.window.registerTreeDataProvider(
    "codeTree",
    treeProvider,
  );
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
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        const monorepoFolder = await (async () => {
          for (const folder of workspaceFolders) {
            if (await isMonorepoFast(folder)) return folder;
          }
          return undefined;
        })();

        if (monorepoFolder) {
          clearAnalysisIndexes();
          await CodeWebviewProvider.showRoadmapMonorepoPrompt(
            context,
            monorepoFolder.name,
          );
          return;
        }

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
          vscode.window.showWarningMessage(
            "No functions found. Showing file/import roadmap only.",
          );
        }

        // ✅ ШИНЭ: Dependencies тоог харуулах
        vscode.window.showInformationMessage(
          `✓ Roadmap ready: ${fileCount} files, ${functionCount} functions, ${dependencyCount} imports`,
        );

        CodeWebviewProvider.showRoadmap(context);
        await CodeWebviewProvider.refreshRoadmapPanelFromIndexes();
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

  const pickMonorepoRoadmapProjectDisposable = vscode.commands.registerCommand(
    "experiment.pickMonorepoRoadmapProject",
    async () => {
      try {
        await runMonorepoProjectPickerFlow(context);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error selecting monorepo project: ${
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
  // const askAIDisposable = vscode.commands.registerCommand(
  //   "experiment.askAI",
  //   async () => {
  //     try {
  //       // 1. API key шалгах
  //       const hasKey = await aiService.hasApiKey();
  //       if (!hasKey) {
  //         vscode.window.showErrorMessage(
  //           "API key тохируулаагүй. Sidebar-аас тохируулна уу.",
  //         );
  //         return;
  //       }

  //       // 2. Active editor
  //       const editor = vscode.window.activeTextEditor;
  //       if (!editor) {
  //         vscode.window.showErrorMessage("Файл нээнэ үү");
  //         return;
  //       }

  //       // 3. Workspace scan
  //       const files = await scanWorkspaceFiles();
  //       if (files.length > 0) {
  //         await loadWorkspaceFileContents(files);
  //         analyzeFunctionBoundaries(fileIndex.getAll());
  //         analyzeFunctionCalls(fileIndex.getAll());
  //       }

  //       // 4. Graph-аас relevant files олох
  //       const currentFilePath = editor.document.uri.fsPath;
  //       const relevantFiles =
  //         relevantFilesResolver.getRelevantFiles(currentFilePath);

  //       // ✅ ЗАСВАР: Файлын агуулгыг нэмж өгөх
  //       const relevantFilesWithContent = relevantFiles.map((rf) => {
  //         try {
  //           // fileIndex-ээс авах оролдлого
  //           const indexedFile = fileIndex
  //             .getAll()
  //             .find((f) => f.path === rf.path);

  //           if (indexedFile) {
  //             return {
  //               path: rf.path,
  //               content: indexedFile.text,
  //             };
  //           }

  //           // fileIndex дээр олдохгүй бол файлаас шууд уншиж авах
  //           if (fs.existsSync(rf.path)) {
  //             const content = fs.readFileSync(rf.path, "utf-8");
  //             return {
  //               path: rf.path,
  //               content: content,
  //             };
  //           }

  //           // Файл олдохгүй бол хоосон агуулга өгөх
  //           console.warn(`⚠️ File not found: ${rf.path}`);
  //           return {
  //             path: rf.path,
  //             content: `// File not found: ${rf.path}`,
  //           };
  //         } catch (error) {
  //           console.error(`Error reading file ${rf.path}:`, error);
  //           return {
  //             path: rf.path,
  //             content: `// Error reading file: ${error instanceof Error ? error.message : "Unknown error"}`,
  //           };
  //         }
  //       });

  //       const providerName = aiService.getProviderConfig().name;
  //       vscode.window.showInformationMessage(
  //         `📁 ${relevantFilesWithContent.length} файл → ${providerName}`,
  //       );

  //       // 5. Асуулт авах
  //       const question = await vscode.window.showInputBox({
  //         prompt: `${providerName}-аас асуух`,
  //         placeHolder: "Энэ код юу хийдэг вэ?",
  //         ignoreFocusOut: true,
  //       });

  //       if (!question) return;

  //       // 6. AI руу илгээх
  //       await vscode.window.withProgress(
  //         {
  //           location: vscode.ProgressLocation.Notification,
  //           title: `${providerName} хариулж байна...`,
  //           cancellable: false,
  //         },
  //         async () => {
  //           const answer = await aiService.askWithContext(
  //             relevantFilesWithContent,
  //             question,
  //           );

  //           // 7. Хариуг харуулах
  //           const doc = await vscode.workspace.openTextDocument({
  //             content: `# ${providerName} Хариулт\n\n**Асуулт:** ${question}\n\n**Контекст:** ${relevantFilesWithContent.length} файл\n- ${relevantFilesWithContent.map((f) => f.path).join("\n- ")}\n\n---\n\n${answer}`,
  //             language: "markdown",
  //           });
  //           await vscode.window.showTextDocument(doc, { preview: true });
  //         },
  //       );
  //     } catch (error) {
  //       vscode.window.showErrorMessage(
  //         `AI алдаа: ${error instanceof Error ? error.message : "Unknown"}`,
  //       );
  //       console.error(error);
  //     }
  //   },
  // );

  // ============================================
  // REGISTER ALL COMMANDS
  // ============================================
  context.subscriptions.push(disposable);
  context.subscriptions.push(roadmapDisposable);
  context.subscriptions.push(pickMonorepoRoadmapProjectDisposable);
  // context.subscriptions.push(askAIDisposable);
}

export function deactivate() {
  console.log("Extension deactivated");
}
