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
import { getElement } from "./utils";
import { findFileNodeByPath } from "./hierarchy";

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
    };
  }
}

function applyRoadmapDataUpdate(newData: typeof state.roadmapData): void {
  const previousScale = state.scale;
  const previousTranslateX = state.translateX;
  const previousTranslateY = state.translateY;
  const focusedFilePath = state.focusedFile?.fullPath;

  state.setRoadmapData(newData);
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

  resetView: () => {
    state.clearExpandedFolders();
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

// Initialize
// Initialize
function init(): void {
  if (state.roadmapData?.files?.length > 0) {
    console.log("✅ Init:", state.roadmapData.files.length, "files");

    renderGraph();
    setupCanvasEvents();

    // Check if we should restore previous view state
    const shouldRestore =
      new URLSearchParams(window.location.search).get("restore") === "true";

    if (shouldRestore) {
      // Try to restore from previous state (will be sent via postMessage)
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
