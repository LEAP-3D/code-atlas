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
let interactionsInitialized = false;
let hintInitialized = false;

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
      copyFile: (filePath: string) => void;
      copyAll: (filePath: string) => void;
      copyForAI: (filePath: string) => void;
      toggleSection: (sectionId: string) => void;
      toggleCopyDropdown: () => void;
      closeCopyDropdown: () => void;
      clearSearch: () => void;
    };
  }
}

function ensureEmptyStateElement(): HTMLDivElement {
  let el = document.getElementById(
    "roadmapEmptyState",
  ) as HTMLDivElement | null;
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

function updateSearchMeta(): void {
  const meta = document.getElementById("roadmapSearchMeta");
  const clearBtn = document.getElementById(
    "roadmapSearchClearBtn",
  ) as HTMLButtonElement | null;

  if (!meta) {
    return;
  }

  if (!state.hasActiveSearch()) {
    meta.textContent = "";
    if (clearBtn) clearBtn.style.visibility = "hidden";
    return;
  }

  const matchCount = state.matchedNodeIds.size;
  meta.textContent = `${matchCount} match${matchCount === 1 ? "" : "es"}`;
  if (clearBtn) clearBtn.style.visibility = "visible";
}

function applySearch(query: string): void {
  state.setSearchQuery(query);
  renderGraph();
  updateSearchMeta();
}

function setupSearchControls(): void {
  const searchInput = document.getElementById(
    "roadmapSearchInput",
  ) as HTMLInputElement | null;
  if (!searchInput || searchInput.dataset.bound === "true") {
    updateSearchMeta();
    return;
  }

  searchInput.dataset.bound = "true";
  searchInput.value = state.searchQuery;

  searchInput.addEventListener("input", () => {
    applySearch(searchInput.value);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      searchInput.value = "";
      applySearch("");
      searchInput.blur();
    }
  });

  updateSearchMeta();
}

function applyRoadmapDataUpdate(newData: typeof state.roadmapData): void {
  const wasEmpty = (state.roadmapData?.files?.length || 0) === 0;
  const previousScale = state.scale;
  const previousTranslateX = state.translateX;
  const previousTranslateY = state.translateY;
  const focusedFilePath = state.focusedFile?.fullPath;

  state.setRoadmapData(newData);

  autoExpandFoldersWithFiles();
  hideEmptyState();
  ensureInteractionsInitialized();

  renderGraph();
  updateSearchMeta();

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

function autoExpandFoldersWithFiles(): void {
  if (!state.hierarchyData) {
    console.log("⚠️ No hierarchy data");
    return;
  }

  let expandedCount = 0;

  function expandFolder(node: HierarchyNode): void {
    const nodeId = getNodeId(node);

    if (node.files && node.files.length > 0 && nodeId) {
      state.expandedFolders.add(nodeId);
      expandedCount++;
      console.log(`📂 Expanded: ${node.name} (${node.files.length} files)`);
    }

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

  copyFile: (filePath: string) => {
    console.log("📄 Copying file:", filePath);
    state.vscode.postMessage({
      command: "copyFile",
      filePath: filePath,
    });
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    showCopyToast(`📄 ${fileName} copied`);
  },

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

    showCopyToast(`📋 ${allFiles.size} files copied`);
  },

  copyForAI: (filePath: string) => {
    if (!state.roadmapData || !state.hierarchyData) return;

    const fileNode = findFileNodeByPath(state.hierarchyData, filePath);
    if (!fileNode) return;

    const deps = state.roadmapData.dependencies || [];
    const imports = deps.filter((d) => d.importerFilePath === filePath);
    const importedBy = deps.filter((d) => d.importedFilePath === filePath);

    // Collect all related files
    const allFiles = new Set<string>();
    allFiles.add(filePath);
    imports.forEach((dep) => allFiles.add(dep.importedFilePath));
    importedBy.forEach((dep) => allFiles.add(dep.importerFilePath));

    const fileName = fileNode.name;
    const funcCount = fileNode.functions?.length || 0;

    let context = `# 🐛 Fix These Errors\n\n`;
    context += `## Error File: ${fileName}\n\n`;

    if (fileNode.errorCount > 0) {
      context += `### Errors Found:\n`;
      context += `${fileNode.errorCount} error${fileNode.errorCount > 1 ? "s" : ""} detected in this file.\n\n`;
    }

    context += `### Context:\n`;
    context += `- **Functions**: ${funcCount}\n`;
    context += `- **Imports**: ${imports.length}\n`;
    context += `- **Used By**: ${importedBy.length}\n\n`;

    if (imports.length > 0) {
      context += `## 📥 Imports\n\n`;
      imports.forEach((dep) => {
        const depFile = dep.importedFilePath.split(/[/\\]/).pop();
        context += `- **${depFile}**: ${dep.importedNames.join(", ")}\n`;
      });
      context += `\n`;
    }

    if (importedBy.length > 0) {
      context += `## 📤 Used By\n\n`;
      importedBy.forEach((dep) => {
        const depFile = dep.importerFilePath.split(/[/\\]/).pop();
        context += `- **${depFile}**: ${dep.importedNames.join(", ")}\n`;
      });
      context += `\n`;
    }

    context += `### Instructions:\n`;
    context += `Please fix ALL errors listed above in the ${fileName} file.\n\n`;
    context += `**Requirements:**\n`;
    context += `1. Fix each error on the specified line\n`;
    context += `2. Maintain existing functionality\n`;
    context += `3. Keep the same code style\n`;
    context += `4. Return ONLY the corrected code for ${fileName}\n`;
    context += `5. No explanations needed - just the fixed code\n\n`;
    context += `---\n\n`;
    context += `## File Content:\n`;
    context += `\`\`\`javascript\n`;
    context += `// ${fileName} content will be inserted here by the extension\n`;
    context += `\`\`\`\n`;

    // Send AI context with ALL related files
    state.vscode.postMessage({
      command: "copyAIContext",
      errorFile: filePath,
      context: context,
      files: Array.from(allFiles), // Include all files for AI
    });

    showCopyToast(`🤖 AI context with ${allFiles.size} files copied!`);
  },

  toggleSection: (sectionId: string) => {
    const content = document.getElementById(`${sectionId}-content`);
    const toggle = document.getElementById(`${sectionId}-toggle`);

    if (!content || !toggle) return;

    const isCollapsed = content.classList.contains("collapsed");

    if (isCollapsed) {
      content.classList.remove("collapsed");
      toggle.textContent = "▼";
    } else {
      content.classList.add("collapsed");
      toggle.textContent = "▶";
    }
  },

  toggleCopyDropdown: () => {
    const dropdown = document.getElementById("copyDropdownMenu");
    if (dropdown) {
      dropdown.classList.toggle("show");
    }
  },

  closeCopyDropdown: () => {
    const dropdown = document.getElementById("copyDropdownMenu");
    if (dropdown) {
      dropdown.classList.remove("show");
    }
  },

  resetView: () => {
    state.clearExpandedFolders();
    autoExpandFoldersWithFiles();
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

  clearSearch: () => {
    const searchInput = document.getElementById(
      "roadmapSearchInput",
    ) as HTMLInputElement | null;
    if (searchInput) {
      searchInput.value = "";
    }
    applySearch("");
  },
};

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("copyDropdownMenu");
  const container = document.querySelector(".copy-dropdown-container");

  if (dropdown && container && !container.contains(e.target as Node)) {
    dropdown.classList.remove("show");
  }
});

function init(): void {
  ensureInteractionsInitialized();
  setupSearchControls();
  if (state.roadmapData?.files?.length > 0) {
    console.log("✅ Init:", state.roadmapData.files.length, "files");

    autoExpandFoldersWithFiles();

    renderGraph();

    const shouldRestore =
      new URLSearchParams(window.location.search).get("restore") === "true";

    if (shouldRestore) {
      console.log("🔄 Waiting for state restoration...");
    } else {
      setTimeout(resetView, 100);
    }
  } else {
    console.error("❌ No files");
    showEmptyState("No files found", "No roadmap data is loaded yet.");
  }

  state.vscode.postMessage({ command: "roadmapWebviewReady" });
}

window.addEventListener("message", (event) => {
  const message = event.data;

  if (message.type === "restoreState" && message.state) {
    console.log("🔄 Restoring view state:", message.state);

    state.setScale(message.state.scale);
    state.setTranslate(message.state.translateX, message.state.translateY);
    updateTransform();

    getElement<HTMLDivElement>("zoomLevel").textContent =
      `${Math.round(message.state.scale * 100)}%`;

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
    setupSearchControls();

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

  if (message.type === "roadmapEmptyState") {
    showEmptyState(
      message.title || "Project roadmap",
      message.message || "No roadmap data loaded.",
      message.actionLabel,
      message.actionCommand,
    );
  }
});

init();
