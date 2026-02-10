// Main entry point for roadmap webview

import * as state from "./state";
import { renderGraph } from "./renderer";
import { resetView, setupCanvasEvents, setupHintTimeout } from "./interactions";
import { jumpToFile, closeFunctionPanel } from "./panel";
import { zoomIn, zoomOut } from "./interactions";
import { getElement } from "./utils";

// Initialize VS Code API
state.setVscode(window.acquireVsCodeApi());

// Load roadmap data
state.setRoadmapData(window.ROADMAP_DATA || {
  files: [],
  dependencies: [],
  totalFiles: 0,
  totalFunctions: 0,
  totalConnections: 0,
});

console.log(
  "🗺️ Roadmap loaded:",
  state.roadmapData.files.length,
  "files,",
  state.roadmapData.dependencies.length,
  "deps"
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
      zoomIn: () => void;
      zoomOut: () => void;
    };
  }
}

window.roadmapActions = {
  goToFunction: (filePath: string, line: number) => {
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

  resetView: resetView,
  closeFunctionPanel: closeFunctionPanel,
  zoomIn: zoomIn,
  zoomOut: zoomOut,
};

// Initialize
function init(): void {
  if (state.roadmapData?.files?.length > 0) {
    console.log("✅ Init:", state.roadmapData.files.length, "files");
    
    renderGraph();
    setupCanvasEvents();
    
    setTimeout(resetView, 100);
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

// Run on load
init();