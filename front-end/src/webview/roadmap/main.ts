// Main entry point for roadmap webview

import * as state from "./state";
import { renderGraph } from "./renderer";
import {
  resetView,
  setupCanvasEvents,
  setupHintTimeout,
  updateTransform,
} from "./interactions";
import {
  jumpToFile,
  closeFunctionPanel,
  focusOnFile,
  toggleFunctionPanel,
  clearFileSelection,
} from "./panel";
import { zoomIn, zoomOut } from "./interactions";
import { getElement, getNodeId } from "./utils";
import { findFileNodeByPath } from "./hierarchy";
import { HierarchyNode } from "./types";

// Initialize VS Code API
state.setVscode(window.acquireVsCodeApi());

// Load roadmap data
state.setRoadmapData(
  window.ROADMAP_DATA || {
    files: [],
    dependencies: [],
    totalFiles: 0,
    totalFunctions: 0,
    totalConnections: 0,
  },
);

console.log(
  "🗺️ Roadmap loaded:",
  state.roadmapData.files.length,
  "files,",
  state.roadmapData.dependencies.length,
  "deps",
);

// ✅ ШИНЭ: Toast мессеж харуулах функц
function showCopyToast(message: string): void {
  const existing = document.querySelector(".copy-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "copy-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// Expose actions to window for HTML onclick handlers
declare global {
  interface Window {
    roadmapActions: {
      goToFunction: (filePath: string, line: number) => void;
      jumpToFile: (filePath: string) => void;
      debugExecutionFlow: (filePath: string) => void;
      resetView: () => void;
      closeFunctionPanel: () => void;
      toggleFunctionPanel: () => void;
      clearFileSelection: () => void;
      zoomIn: () => void;
      zoomOut: () => void;
      refreshRoadmap: () => void;
      copyFile: (filePath: string) => void;
      copyAll: (filePath: string) => void;
      copyForAI: (filePath: string) => void;
    };
  }
}

function applyRoadmapDataUpdate(newData: typeof state.roadmapData): void {
  const previousScale = state.scale;
  const previousTranslateX = state.translateX;
  const previousTranslateY = state.translateY;
  const focusedFilePath = state.focusedFile?.fullPath;

  state.setRoadmapData(newData);

  // Folder-ууд дахин нээх
  autoExpandFoldersWithFiles();

  renderGraph();

  state.setScale(previousScale);
  state.setTranslate(previousTranslateX, previousTranslateY);
  updateTransform();
  getElement<HTMLDivElement>("zoomLevel").textContent =
    `${Math.round(previousScale * 100)}%`;

  if (focusedFilePath && state.hierarchyData) {
    const fileNode = findFileNodeByPath(state.hierarchyData, focusedFilePath);
    if (fileNode) {
      focusOnFile(fileNode);
    }
  }
}

/**
 * ✅ ШИНЭ ФУНКЦ: Файлтай folder-уудыг автоматаар нээх
 */
function autoExpandFoldersWithFiles(): void {
  if (!state.hierarchyData) {
    console.log("⚠️ Hierarchy data байхгүй байна");
    return;
  }

  let expandedCount = 0;

  function expandFolder(node: HierarchyNode): void {
    const nodeId = getNodeId(node);

    // Энэ folder-т файл байвал нээх
    if (node.files && node.files.length > 0 && nodeId) {
      state.expandedFolders.add(nodeId);
      expandedCount++;
      console.log(`📂 Нээгдсэн: ${node.name} (${node.files.length} файл)`);
    }

    // Дотоод folder-уудыг мөн шалгах
    if (node.children) {
      Object.values(node.children).forEach((child) => {
        expandFolder(child);
      });
    }
  }

  expandFolder(state.hierarchyData);
  console.log(`✅ Нийт ${expandedCount} folder автоматаар нээгдлээ`);
}

window.roadmapActions = {
  goToFunction: (filePath: string, line: number) => {
    state.vscode.postMessage({
      command: "saveState",
      state: {
        scale: state.scale,
        translateX: state.translateX,
        translateY: state.translateY,
        focusedFilePath: state.focusedFile?.fullPath,
      },
    });

    state.vscode.postMessage({
      command: "goToFunction",
      filePath: filePath,
      line: line || 1,
    });
  },

  jumpToFile: jumpToFile,

  debugExecutionFlow: (filePath: string) => {
    console.log("🐛 Debug execution flow for:", filePath);
    state.vscode.postMessage({
      command: "debugExecutionFlow",
      filePath: filePath,
    });
  },

  // ✅ ШИНЭ: Copy зөвхөн сонгосон файл
  copyFile: (filePath: string) => {
    state.vscode.postMessage({
      command: "copyFile",
      filePath: filePath,
    });
    showCopyToast(`📄 ${filePath.split(/[/\\]/).pop()} хуулагдлаа`);
  },

  // ✅ ШИНЭ: Copy бүх холбоотой файлууд
  copyAll: (filePath: string) => {
    if (!state.roadmapData || !state.hierarchyData) return;

    const deps = state.roadmapData.dependencies || [];
    const imports = deps.filter((d) => d.importerFilePath === filePath);
    const importedBy = deps.filter((d) => d.importedFilePath === filePath);

    const allFiles = new Set<string>();
    allFiles.add(filePath);
    imports.forEach((dep) => allFiles.add(dep.importedFilePath));
    importedBy.forEach((dep) => allFiles.add(dep.importerFilePath));

    state.vscode.postMessage({
      command: "copyAllFiles",
      files: Array.from(allFiles),
    });

    showCopyToast(`📋 ${allFiles.size} файл хуулагдлаа`);
  },

  // ✅ ШИНЭ: Copy for AI
  copyForAI: (filePath: string) => {
    if (!state.roadmapData || !state.hierarchyData) return;

    const fileNode = findFileNodeByPath(state.hierarchyData, filePath);
    if (!fileNode) return;

    const deps = state.roadmapData.dependencies || [];
    const imports = deps.filter((d) => d.importerFilePath === filePath);
    const importedBy = deps.filter((d) => d.importedFilePath === filePath);

    const fileName = fileNode.name;
    const funcCount = fileNode.functions?.length || 0;

    let context = `# 📄 ${fileName}\n\n`;

    if (fileNode.errorCount > 0) {
      context += `## ⚠️ ${fileNode.errorCount} алдаа илэрсэн\n\n`;
      context += `Энэ файл дахь бүх алдааг засаж өгнө үү.\n\n`;
    }

    context += `## 📊 Мэдээлэл\n`;
    context += `- **Функц**: ${funcCount}\n`;
    context += `- **Import**: ${imports.length}\n`;
    context += `- **Exported to**: ${importedBy.length}\n\n`;

    if (imports.length > 0) {
      context += `## 📥 Import хийсэн файлууд\n\n`;
      imports.forEach((dep) => {
        const depFile = dep.importedFilePath.split(/[/\\]/).pop();
        context += `- **${depFile}**: ${dep.importedNames.join(", ")}\n`;
      });
      context += `\n`;
    }

    if (importedBy.length > 0) {
      context += `## 📤 Import хийсэн файлууд\n\n`;
      importedBy.forEach((dep) => {
        const depFile = dep.importerFilePath.split(/[/\\]/).pop();
        context += `- **${depFile}**: ${dep.importedNames.join(", ")}\n`;
      });
      context += `\n`;
    }

    context += `## 💻 Файлын агуулга\n\n\`\`\`javascript\n`;
    context += `// ${fileName} агуулга энд орно\n\`\`\`\n`;

    state.vscode.postMessage({
      command: "copyAIContext",
      errorFile: filePath,
      context: context,
    });

    showCopyToast("🤖 AI context хуулагдлаа!");
  },

  resetView: () => {
    state.clearExpandedFolders();
    autoExpandFoldersWithFiles(); // Дахин нээх
    renderGraph();
    resetView();
  },

  closeFunctionPanel: closeFunctionPanel,
  toggleFunctionPanel: toggleFunctionPanel,
  clearFileSelection: clearFileSelection,
  zoomIn: zoomIn,
  zoomOut: zoomOut,

  refreshRoadmap: () => {
    const btn = getElement<HTMLButtonElement>("refreshRoadmapBtn");
    btn.disabled = true;
    btn.textContent = "Refreshing...";
    state.vscode.postMessage({ command: "refreshRoadmapData" });
  },
};

/**
 * ✅ ЗАСВАРЛАСАН: Initialize - folder-ууд автоматаар нээгдэнэ
 */
function init(): void {
  if (state.roadmapData?.files?.length > 0) {
    console.log("✅ Init:", state.roadmapData.files.length, "files");

    // ✅ ШИНЭ: Folder-уудыг эхлээд нээх
    autoExpandFoldersWithFiles();

    renderGraph();
    setupCanvasEvents();

    // Check if we should restore previous view state
    const shouldRestore =
      new URLSearchParams(window.location.search).get("restore") === "true";

    if (shouldRestore) {
      console.log("🔄 Waiting for state restoration...");
    } else {
      setTimeout(resetView, 100);
    }

    setupHintTimeout();
  } else {
    console.error("❌ No files");
    getElement<HTMLDivElement>("nodesContainer").innerHTML = `
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:#666">
        <div style="font-size:64px;margin-bottom:16px">📭</div>
        <h3>No files found</h3>
      </div>
    `;
  }
}

// Add message handler to restore state
window.addEventListener("message", (event) => {
  const message = event.data;

  if (message.type === "restoreState" && message.state) {
    console.log("🔄 Restoring view state:", message.state);

    state.setScale(message.state.scale);
    state.setTranslate(message.state.translateX, message.state.translateY);
    updateTransform();

    getElement<HTMLDivElement>("zoomLevel").textContent =
      `${Math.round(message.state.scale * 100)}%`;

    // Restore focused file if exists
    if (message.state.focusedFilePath && state.hierarchyData) {
      const fileNode = findFileNodeByPath(
        state.hierarchyData,
        message.state.focusedFilePath,
      );
      if (fileNode) {
        focusOnFile(fileNode);
      }
    }
  }

  if (message.type === "roadmapDataUpdated" && message.data) {
    applyRoadmapDataUpdate(message.data);

    const btn = getElement<HTMLButtonElement>("refreshRoadmapBtn");
    btn.disabled = false;
    btn.textContent = "Refresh Errors";
  }

  if (message.type === "roadmapDataRefreshFailed") {
    const btn = getElement<HTMLButtonElement>("refreshRoadmapBtn");
    btn.disabled = false;
    btn.textContent = "Refresh Errors";
    console.error("❌ Failed to refresh roadmap data:", message.error);
  }
});

// Run on load
init();
