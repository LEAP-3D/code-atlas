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
import { HierarchyNode, RoadmapData } from "./types";
import {
  RoadmapCommandMessage,
  RoadmapCommandName,
  RoadmapDiagnosticItem,
  isRoadmapWebviewMessage,
} from "./messages";

state.setVscode(window.acquireVsCodeApi());
let interactionsInitialized = false;
let hintInitialized = false;
let refreshInProgress = false;
let refreshCooldownTimer: number | null = null;
const pendingErrorDetails = new Map<string, string>();

state.setRoadmapData(
  window.ROADMAP_DATA || {
    files: [],
    dependencies: [],
    totalFiles: 0,
    totalFunctions: 0,
    totalConnections: 0,
  },
);

function postRoadmapCommand(message: RoadmapCommandMessage): void {
  state.vscode.postMessage(message);
}

function isRoadmapData(value: unknown): value is RoadmapData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const data = value as Partial<RoadmapData>;
  return (
    Array.isArray(data.files) &&
    Array.isArray(data.dependencies) &&
    typeof data.totalFiles === "number" &&
    typeof data.totalFunctions === "number" &&
    typeof data.totalConnections === "number"
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function severityLabel(issue: RoadmapDiagnosticItem): string {
  const icon =
    issue.severity === "error"
      ? "E"
      : issue.severity === "warning"
        ? "W"
        : issue.severity === "info"
          ? "I"
          : "H";
  const source = issue.source ? ` - ${escapeHtml(issue.source)}` : "";
  const code = issue.code ? ` (${escapeHtml(issue.code)})` : "";
  return `${icon}${source}${code}`;
}

function renderIssues(
  container: HTMLElement,
  filePath: string,
  issues: RoadmapDiagnosticItem[],
): void {
  if (issues.length === 0) {
    container.innerHTML =
      '<div class="error-lines-empty">No diagnostics reported by VS Code for this file.</div>';
    return;
  }

  const issuesByLine = new Map<number, RoadmapDiagnosticItem[]>();
  for (const issue of issues) {
    const lineIssues = issuesByLine.get(issue.line) || [];
    lineIssues.push(issue);
    issuesByLine.set(issue.line, lineIssues);
  }

  const sortedLines = Array.from(issuesByLine.keys()).sort((a, b) => a - b);
  let html = '<div class="error-lines-list">';

  for (const lineNum of sortedLines) {
    const lineIssues = issuesByLine.get(lineNum) || [];
    const first = lineIssues[0];
    const preview =
      first.message.length > 90
        ? `${escapeHtml(first.message.substring(0, 90))}...`
        : escapeHtml(first.message);
    const tooltip = escapeHtml(lineIssues.map((item) => item.message).join("\n"));
    const badges = lineIssues
      .map(
        (item) =>
          `<span class="diag-chip diag-${item.severity}">${severityLabel(item)}</span>`,
      )
      .join("");

    html += `
      <div class="error-line-item"
           onclick="event.stopPropagation(); window.roadmapActions.goToFunction('${filePath.replace(/\\/g, "\\\\")}', ${lineNum})"
           title="${tooltip}">
        <div class="error-line-row">
          <div class="error-line-number">Line ${lineNum}</div>
          <div class="error-line-chips">${badges}</div>
        </div>
        <div class="error-line-message">${preview}</div>
      </div>
    `;
  }

  html += "</div>";
  container.innerHTML = html;
}

function showCopyToast(message: string): void {
  const existing = document.querySelector(".copy-toast");
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.className = "copy-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function updateLastUpdated(timestamp: number): void {
  const metaEl = document.getElementById("roadmapLastUpdated");
  if (!metaEl) return;
  metaEl.textContent = `Updated ${formatTimestamp(timestamp)}`;
}

function finishRefreshUi(ok: boolean, timestamp?: number): void {
  const btn = getElement<HTMLButtonElement>("refreshRoadmapBtn");
  btn.disabled = false;
  btn.textContent = "Refresh Errors";
  refreshInProgress = false;
  if (refreshCooldownTimer !== null) {
    window.clearTimeout(refreshCooldownTimer);
  }
  refreshCooldownTimer = window.setTimeout(() => {
    refreshCooldownTimer = null;
  }, 800);

  if (ok && timestamp) {
    updateLastUpdated(timestamp);
  }
}

declare global {
  interface Window {
    ROADMAP_DATA: typeof state.roadmapData;
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
      copyForAIErrorOnly: (filePath: string) => void;
      toggleSection: (sectionId: string) => void;
      loadErrorDetails: (filePath: string) => void;
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
        postRoadmapCommand({
          command: actionCommand as RoadmapCommandName,
        });
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

function applyRoadmapDataUpdate(newData: RoadmapData): void {
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
    return;
  }

  function expandFolder(node: HierarchyNode): void {
    const nodeId = getNodeId(node);
    if (node.files && node.files.length > 0 && nodeId) {
      state.expandedFolders.add(nodeId);
    }

    if (node.children) {
      Object.values(node.children).forEach((child) => {
        expandFolder(child);
      });
    }
  }

  expandFolder(state.hierarchyData);
}

function setCopyDropdownState(dropdown: HTMLElement, isOpen: boolean): void {
  const container = dropdown.closest(".copy-dropdown-container");
  if (!(container instanceof HTMLElement)) {
    dropdown.classList.toggle("show", isOpen);
    return;
  }

  if (isOpen) {
    dropdown.classList.add("show");
    const dropdownSpace = dropdown.scrollHeight + 10;
    container.classList.add("dropdown-open");
    container.style.setProperty("--copy-dropdown-space", `${dropdownSpace}px`);
    return;
  }

  dropdown.classList.remove("show");
  container.classList.remove("dropdown-open");
  container.style.setProperty("--copy-dropdown-space", "0px");
}

window.roadmapActions = {
  goToFunction: (filePath: string, line: number) => {
    postRoadmapCommand({
      command: "saveState",
      state: {
        scale: state.scale,
        translateX: state.translateX,
        translateY: state.translateY,
        focusedFilePath: state.focusedFile?.fullPath,
      },
    });

    postRoadmapCommand({
      command: "goToFunction",
      filePath,
      line: line || 1,
    });
  },

  jumpToFile,

  debugExecutionFlow: (filePath: string) => {
    postRoadmapCommand({
      command: "debugExecutionFlow",
      filePath,
    });
  },

  copyFile: (filePath: string) => {
    postRoadmapCommand({
      command: "copyFile",
      filePath,
    });
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    showCopyToast(`Copied ${fileName}`);
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

    postRoadmapCommand({
      command: "copyAllFiles",
      files: Array.from(allFiles),
    });

    showCopyToast(`Copied ${allFiles.size} files`);
  },

  copyForAI: (filePath: string) => {
    if (!state.roadmapData || !state.hierarchyData) return;

    const fileNode = findFileNodeByPath(state.hierarchyData, filePath);
    if (!fileNode) return;

    const deps = state.roadmapData.dependencies || [];
    const imports = deps.filter((d) => d.importerFilePath === filePath);
    const importedBy = deps.filter((d) => d.importedFilePath === filePath);

    const allFiles = new Set<string>();
    allFiles.add(filePath);
    imports.forEach((dep) => allFiles.add(dep.importedFilePath));
    importedBy.forEach((dep) => allFiles.add(dep.importerFilePath));

    const fileName = fileNode.name;
    const funcCount = fileNode.functions?.length || 0;
    let context = `# Fix These Diagnostics\n\n`;
    context += `## File: ${fileName}\n\n`;
    context += `### Context\n`;
    context += `- Functions: ${funcCount}\n`;
    context += `- Imports: ${imports.length}\n`;
    context += `- Used by: ${importedBy.length}\n\n`;
    context += `## File Content\n`;
    context += "```javascript\n";
    context += `// ${fileName} content will be inserted here by the extension\n`;
    context += "```\n";

    postRoadmapCommand({
      command: "copyAIContext",
      errorFile: filePath,
      context,
      files: Array.from(allFiles),
    });

    showCopyToast("AI context copied");
  },

  copyForAIErrorOnly: (filePath: string) => {
    if (!state.roadmapData || !state.hierarchyData) return;

    const fileNode = findFileNodeByPath(state.hierarchyData, filePath);
    if (!fileNode) return;

    const fileName = fileNode.name;
    let context = `# Fix These Diagnostics\n\n`;
    context += `## File: ${fileName}\n\n`;
    context += `## File Content\n`;
    context += "```javascript\n";
    context += `// ${fileName} content will be inserted here by the extension\n`;
    context += "```\n";

    postRoadmapCommand({
      command: "copyAIContext",
      errorFile: filePath,
      context,
      files: [filePath],
    });

    showCopyToast("AI context copied");
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

  loadErrorDetails: (filePath: string) => {
    const containerId = `errorLines-${filePath.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const container = document.getElementById(containerId);
    if (!container) return;

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingErrorDetails.set(requestId, containerId);
    container.innerHTML = '<div class="error-lines-loading">Loading diagnostics...</div>';

    postRoadmapCommand({
      command: "getErrorDetails",
      filePath,
      requestId,
      includeWarnings: true,
    });
  },

  toggleCopyDropdown: () => {
    const dropdown = document.getElementById("copyDropdownMenu");
    if (!(dropdown instanceof HTMLElement)) return;

    const shouldOpen = !dropdown.classList.contains("show");
    setCopyDropdownState(dropdown, shouldOpen);
  },

  closeCopyDropdown: () => {
    const dropdown = document.getElementById("copyDropdownMenu");
    if (!(dropdown instanceof HTMLElement)) return;
    setCopyDropdownState(dropdown, false);
  },

  resetView: () => {
    state.clearExpandedFolders();
    autoExpandFoldersWithFiles();
    renderGraph();
    resetView();
  },

  closeFunctionPanel,
  toggleFunctionPanel,
  clearFileSelection,
  zoomIn,
  zoomOut,

  refreshRoadmap: () => {
    if (refreshInProgress || refreshCooldownTimer !== null) {
      return;
    }

    refreshInProgress = true;
    const btn = getElement<HTMLButtonElement>("refreshRoadmapBtn");
    btn.disabled = true;
    btn.textContent = "Refreshing...";
    postRoadmapCommand({ command: "refreshRoadmapData" });
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

document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("copyDropdownMenu");
  const container = document.querySelector(".copy-dropdown-container");

  if (
    dropdown instanceof HTMLElement &&
    container instanceof HTMLElement &&
    !container.contains(e.target as Node)
  ) {
    setCopyDropdownState(dropdown, false);
  }
});

function init(): void {
  ensureInteractionsInitialized();
  setupSearchControls();

  if (state.roadmapData?.files?.length > 0) {
    autoExpandFoldersWithFiles();
    renderGraph();

    const shouldRestore =
      new URLSearchParams(window.location.search).get("restore") === "true";
    if (!shouldRestore) {
      setTimeout(resetView, 100);
    }
  } else {
    showEmptyState("No files found", "No roadmap data is loaded yet.");
  }

  updateLastUpdated(Date.now());
  postRoadmapCommand({ command: "roadmapWebviewReady" });
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (!isRoadmapWebviewMessage(message)) {
    return;
  }

  if (message.type === "restoreState" && message.state) {
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
    return;
  }

  if (message.type === "roadmapDataUpdated") {
    if (!isRoadmapData(message.data)) {
      finishRefreshUi(false);
      return;
    }

    applyRoadmapDataUpdate(message.data);
    setupSearchControls();
    finishRefreshUi(true, message.updatedAt || Date.now());
    return;
  }

  if (message.type === "roadmapDataRefreshFailed") {
    finishRefreshUi(false, message.updatedAt || Date.now());
    return;
  }

  if (message.type === "roadmapEmptyState") {
    showEmptyState(
      message.title || "Project roadmap",
      message.message || "No roadmap data loaded.",
      message.actionLabel,
      message.actionCommand,
    );
    return;
  }

  if (message.type === "errorDetails") {
    const containerId = pendingErrorDetails.get(message.requestId);
    pendingErrorDetails.delete(message.requestId);
    if (!containerId) return;

    const container = document.getElementById(containerId);
    if (!container) return;
    renderIssues(container, message.filePath, message.issues);
  }
});

init();

