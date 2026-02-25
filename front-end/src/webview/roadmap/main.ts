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
console.log("hello");
let interactionsInitialized = false;
let hintInitialized = false;
let searchControlsInitialized = false;

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

// ✅ Toast notification function
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
    ROADMAP_DATA?: typeof state.roadmapData;
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
      clearSearch: () => void;
      copyFile: (filePath: string) => void;
      copyAll: (filePath: string) => void;
      runEmptyStateAction?: () => void;
    };
  }
}

function ensureEmptyStateElement(): HTMLDivElement {
  let el = document.getElementById("roadmapEmptyState") as HTMLDivElement | null;
  if (el) return el;

  el = document.createElement("div");
  el.id = "roadmapEmptyState";
  el.className = "roadmap-empty-state hidden";
  document.body.appendChild(el);
  return el;
}

function showEmptyState(
  title: string,
  message: string,
  actionLabel?: string,
  actionCommand?: string,
): void {
  const el = ensureEmptyStateElement();

  const actionHtml =
    actionLabel && actionCommand
      ? `<button class="empty-state-btn" id="emptyStateActionBtn">${actionLabel}</button>`
      : "";

  el.innerHTML = `
    <div class="empty-state-card">
      <div class="empty-state-icon">🧭</div>
      <h2>${title}</h2>
      <p>${message}</p>
      ${actionHtml}
    </div>
  `;
  el.classList.remove("hidden");

  if (actionLabel && actionCommand) {
    const btn = document.getElementById(
      "emptyStateActionBtn",
    ) as HTMLButtonElement | null;
    if (btn) {
      btn.onclick = () => {
        state.vscode.postMessage({ command: actionCommand });
      };
    }
  }
}

function hideEmptyState(): void {
  const el = document.getElementById("roadmapEmptyState");
  if (el) el.classList.add("hidden");
}

function updateSearchMeta(): void {
  const meta = document.getElementById("roadmapSearchMeta");
  const clearBtn = document.getElementById("roadmapSearchClearBtn") as
    | HTMLButtonElement
    | null;

  if (!meta || !clearBtn) return;

  if (!state.hasActiveSearch()) {
    meta.textContent = "";
    clearBtn.style.visibility = "hidden";
    return;
  }

  clearBtn.style.visibility = "visible";
  meta.textContent = `${state.matchedNodeIds.size} match${state.matchedNodeIds.size === 1 ? "" : "es"}`;
}

function applySearchAndRender(): void {
  renderGraph();
  updateSearchMeta();
}

function centerSearchMatches(): void {
  if (!state.hasActiveSearch() || state.allNodes.length === 0) {
    return;
  }

  const matchedFileNodes = state.allNodes.filter(
    (n) => n.data.type === "file" && state.isSearchMatch(n.element.dataset.id || ""),
  );
  const matchedNodes =
    matchedFileNodes.length > 0
      ? matchedFileNodes
      : state.allNodes.filter((n) => state.isSearchMatch(n.element.dataset.id || ""));

  if (matchedNodes.length === 0) {
    return;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  matchedNodes.forEach((n) => {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  });

  const canvas = getElement<HTMLDivElement>("canvas");
  const rect = canvas.getBoundingClientRect();
  const graphCenterX = (minX + maxX) / 2;
  const graphCenterY = (minY + maxY) / 2;
  const graphWidth = maxX - minX + 280;
  const graphHeight = maxY - minY + 280;
  const newScale = Math.max(
    state.MIN_SCALE,
    Math.min(
      (rect.width * 0.9) / Math.max(graphWidth, 1),
      (rect.height * 0.9) / Math.max(graphHeight, 1),
      1.2,
      state.MAX_SCALE,
    ),
  );
  const CONTAINER_CENTER = 5000;

  state.setScale(newScale);
  state.setTranslate(
    (CONTAINER_CENTER - graphCenterX) * newScale,
    (CONTAINER_CENTER - graphCenterY) * newScale,
  );
  updateTransform();
  getElement<HTMLDivElement>("zoomLevel").textContent =
    `${Math.round(newScale * 100)}%`;
}

function setupSearchControls(): void {
  if (searchControlsInitialized) return;

  const input = document.getElementById("roadmapSearchInput") as
    | HTMLInputElement
    | null;

  if (!input) return;

  input.addEventListener("input", () => {
    state.setSearchQuery(input.value);
    applySearchAndRender();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    centerSearchMatches();
  });

  clearSearchInput();
  searchControlsInitialized = true;
}

function clearSearchInput(): void {
  const input = document.getElementById("roadmapSearchInput") as
    | HTMLInputElement
    | null;
  if (input) {
    input.value = "";
  }
  state.setSearchQuery("");
  updateSearchMeta();
}

function applyRoadmapDataUpdate(newData: typeof state.roadmapData): void {
  const wasEmpty = (state.roadmapData?.files?.length || 0) === 0;
  const previousScale = state.scale;
  const previousTranslateX = state.translateX;
  const previousTranslateY = state.translateY;
  const focusedFilePath = state.focusedFile?.fullPath;

  state.setRoadmapData(newData);

  // Auto-expand folders with files
  autoExpandFoldersWithFiles();
  hideEmptyState();
  ensureInteractionsInitialized();
  setupSearchControls();

  applySearchAndRender();

  if (wasEmpty) {
    setTimeout(resetView, 100);
  } else {
    state.setScale(previousScale);
    state.setTranslate(previousTranslateX, previousTranslateY);
    updateTransform();
    getElement<HTMLDivElement>("zoomLevel").textContent =
      `${Math.round(previousScale * 100)}%`;
  }

  if (focusedFilePath && state.hierarchyData) {
    const fileNode = findFileNodeByPath(state.hierarchyData, focusedFilePath);
    if (fileNode) {
      focusOnFile(fileNode);
    }
  }
}

function ensureInteractionsInitialized(): void {
  if (!interactionsInitialized) {
    setupCanvasEvents();
    interactionsInitialized = true;
  }

  if (!hintInitialized) {
    setupHintTimeout();
    hintInitialized = true;
  }
}

/**
 * Auto-expand folders that contain files
 */
function autoExpandFoldersWithFiles(): void {
  if (!state.hierarchyData) {
    console.log("⚠️ No hierarchy data");
    return;
  }

  let expandedCount = 0;

  function expandFolder(node: HierarchyNode): void {
    const nodeId = getNodeId(node);

    // Expand folder if it has files
    if (node.files && node.files.length > 0 && nodeId) {
      state.expandedFolders.add(nodeId);
      expandedCount++;
      console.log(`📂 Expanded: ${node.name} (${node.files.length} files)`);
    }

    // Check child folders
    if (node.children) {
      Object.values(node.children).forEach((child) => {
        expandFolder(child);
      });
    }
  }

  expandFolder(state.hierarchyData);
  console.log(`✅ Auto-expanded ${expandedCount} folders`);
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

  // ✅ Copy only the selected file
  copyFile: (filePath: string) => {
    console.log("📄 Copying file:", filePath);
    state.vscode.postMessage({
      command: "copyFile",
      filePath: filePath,
    });
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    showCopyToast(`📄 ${fileName} copied to clipboard`);
  },

  // ✅ Copy all related files (imports + imported by)
  copyAll: (filePath: string) => {
    if (!state.roadmapData || !state.hierarchyData) return;

    const deps = state.roadmapData.dependencies || [];
    const imports = deps.filter((d) => d.importerFilePath === filePath);
    const importedBy = deps.filter((d) => d.importedFilePath === filePath);

    const allFiles = new Set<string>();
    allFiles.add(filePath);
    imports.forEach((dep) => allFiles.add(dep.importedFilePath));
    importedBy.forEach((dep) => allFiles.add(dep.importerFilePath));

    console.log("📋 Copying all files:", Array.from(allFiles));
    state.vscode.postMessage({
      command: "copyAllFiles",
      files: Array.from(allFiles),
    });

    showCopyToast(`📋 ${allFiles.size} files copied to clipboard`);
  },

  resetView: () => {
    state.clearExpandedFolders();
    autoExpandFoldersWithFiles();
    applySearchAndRender();
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

  clearSearch: () => {
    clearSearchInput();
    applySearchAndRender();
  },
};

/**
 * Initialize the roadmap
 */
function init(): void {
  ensureInteractionsInitialized();
  setupSearchControls();
  if (state.roadmapData?.files?.length > 0) {
    console.log("✅ Init:", state.roadmapData.files.length, "files");

    // Auto-expand folders with files
    autoExpandFoldersWithFiles();

    applySearchAndRender();

    // Check if we should restore previous view state
    const shouldRestore =
      new URLSearchParams(window.location.search).get("restore") === "true";

    if (shouldRestore) {
      console.log("🔄 Waiting for state restoration...");
    } else {
      setTimeout(resetView, 100);
    }

  } else {
    updateSearchMeta();
    console.error("❌ No files");
    showEmptyState("No files found", "No roadmap data is loaded yet.");
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

  if (message.type === "roadmapEmptyState") {
    showEmptyState(
      message.title || "Project roadmap",
      message.message || "No roadmap data loaded.",
      message.actionLabel,
      message.actionCommand,
    );
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
