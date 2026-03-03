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
  goBackInPanel,
} from "./panel";
import { zoomIn, zoomOut } from "./interactions";
import { getElement, getNodeId } from "./utils";
import { findFileNodeByPath } from "./hierarchy";
import { HierarchyNode, RoadmapData } from "./types";
import {
  RoadmapCommandMessage,
  RoadmapDiagnosticItem,
  isRoadmapWebviewMessage,
} from "./messages";

// Initialize VS Code API
state.setVscode(window.acquireVsCodeApi());
let interactionsInitialized = false;
let hintInitialized = false;
let refreshInProgress = false;
let refreshCooldownTimer: number | null = null;
const pendingErrorDetails = new Map<string, string>();
const errorDetailsByFile = new Map<string, RoadmapDiagnosticItem[]>();
const errorContainerByFile = new Map<string, string>();
let errorPriorityMode = true;
let rootCauseGrouping = true;

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

function severityRank(severity: RoadmapDiagnosticItem["severity"]): number {
  if (severity === "error") return 0;
  if (severity === "warning") return 1;
  if (severity === "info") return 2;
  return 3;
}

function sortIssues(issues: RoadmapDiagnosticItem[]): RoadmapDiagnosticItem[] {
  const copy = [...issues];
  copy.sort((a, b) => {
    if (errorPriorityMode) {
      const bySeverity = severityRank(a.severity) - severityRank(b.severity);
      if (bySeverity !== 0) return bySeverity;
    }
    if (a.line !== b.line) return a.line - b.line;
    return a.message.localeCompare(b.message);
  });
  return copy;
}

function renderRootCauseGroups(
  filePath: string,
  issues: RoadmapDiagnosticItem[],
): string {
  if (!rootCauseGrouping) {
    return "";
  }

  const grouped = new Map<
    string,
    { title: string; count: number; firstLine: number; severity: string }
  >();

  for (const item of issues) {
    if (item.severity !== "error") continue;
    const code = item.code ? escapeHtml(item.code) : "n/a";
    const source = item.source ? escapeHtml(item.source) : "diagnostic";
    const key = `${source}:${code}`;
    const title = `${source}(${code})`;
    const existing = grouped.get(key) || {
      title,
      count: 0,
      firstLine: item.line,
      severity: item.severity,
    };
    existing.count += 1;
    existing.firstLine = Math.min(existing.firstLine, item.line);
    grouped.set(key, existing);
  }

  const top = Array.from(grouped.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.firstLine - b.firstLine;
    })
    .slice(0, 4);

  if (top.length === 0) {
    return "";
  }

  const cards = top
    .map(
      (group, index) => `
      <div class="root-cause-item" onclick="event.stopPropagation(); window.roadmapActions.goToFunction('${filePath.replace(/\\/g, "\\\\")}', ${group.firstLine})">
        <div class="root-cause-rank">#${index + 1}</div>
        <div class="root-cause-main">
          <div class="root-cause-title">${group.title}</div>
          <div class="root-cause-meta">${group.count} error(s) - first at line ${group.firstLine}</div>
        </div>
        <div class="root-cause-cta">Fix first</div>
      </div>
    `,
    )
    .join("");

  return `
    <div class="root-cause-wrap">
      <div class="root-cause-header">First Fix These</div>
      <div class="root-cause-sub">Fix root causes first, then remaining errors.</div>
      ${cards}
    </div>
  `;
}

function renderIssues(
  container: HTMLElement,
  filePath: string,
  issues: RoadmapDiagnosticItem[],
): void {
  const orderedIssues = sortIssues(issues);
  if (orderedIssues.length === 0) {
    const focusedErrorCount =
      state.focusedFile && state.focusedFile.fullPath === filePath
        ? state.focusedFile.errorCount
        : 0;
    const note =
      focusedErrorCount > 0
        ? "Tree shows errors, but VS Code diagnostics are not available for this file now. Open the file and refresh."
        : "No diagnostics reported by VS Code for this file.";
    container.innerHTML =
      `<div class="error-lines-empty">${escapeHtml(note)}</div>`;
    return;
  }

  const issuesByLine = new Map<number, RoadmapDiagnosticItem[]>();
  for (const issue of orderedIssues) {
    const lineIssues = issuesByLine.get(issue.line) || [];
    lineIssues.push(issue);
    issuesByLine.set(issue.line, lineIssues);
  }

  const sortedLines = Array.from(issuesByLine.keys()).sort((a, b) => a - b);
  let html = `${renderRootCauseGroups(filePath, orderedIssues)}<div class="error-lines-list">`;

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

function finishRefreshUi(): void {
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
}

function updateDiagnosticsSummaryUi(): void {
  const el = document.getElementById("roadmapErrorBaseline");
  if (!el) return;
  const summary = state.roadmapData.diagnosticsSummary;
  const baseline = state.roadmapData.errorBaseline;
  if (!summary) {
    el.textContent = "";
    return;
  }

  const deltaText = baseline
    ? `${baseline.deltaFromBaseline > 0 ? "+" : ""}${baseline.deltaFromBaseline}`
    : "0";
  el.textContent = `Today: ${summary.error}E/${summary.warning}W/${summary.info}I/${summary.hint}H | delta ${deltaText}`;
}

function rerenderFocusedDiagnostics(): void {
  const filePath = state.focusedFile?.fullPath;
  if (!filePath) return;
  const issues = errorDetailsByFile.get(filePath);
  const containerId = errorContainerByFile.get(filePath);
  if (!issues || !containerId) return;
  const container = document.getElementById(containerId);
  if (!container) return;
  renderIssues(container, filePath, issues);
}

// Expose actions to window for HTML onclick handlers
declare global {
  interface Window {
    ROADMAP_DATA?: typeof state.roadmapData;
    roadmapActions: {
      goToFunction: (filePath: string, line: number) => void;
      jumpToFile: (filePath: string) => void;
      goBackInPanel: () => void;
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
      copyForAISmart: (filePath: string, includeRelatedFiles: boolean) => void;
      setSimpleDiagnosticMode: (enabled: boolean) => void;
      setErrorViewMode: (mode: string) => void;
      toggleSection: (sectionId: string) => void;
      loadErrorDetails: (filePath: string) => void;
      toggleErrorPriorityMode: (enabled: boolean) => void;
      toggleRootCauseGrouping: (enabled: boolean) => void;
      toggleCopyDropdown: () => void;
      toggleCopySubmenu: (submenuId: string) => void;
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
  updateDiagnosticsSummaryUi();

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
  goBackInPanel: goBackInPanel,

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

  copyForAIErrorOnly: (filePath: string) => {
    if (!state.roadmapData || !state.hierarchyData) return;

    const fileNode = findFileNodeByPath(state.hierarchyData, filePath);
    if (!fileNode) return;

    const deps = state.roadmapData.dependencies || [];
    const imports = deps.filter((d) => d.importerFilePath === filePath);
    const importedBy = deps.filter((d) => d.importedFilePath === filePath);

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

    // Send AI context with ONLY error file (no related files)
    state.vscode.postMessage({
      command: "copyAIContext",
      errorFile: filePath,
      context: context,
      files: [filePath], // Only the error file
    });

    showCopyToast(`🤖 AI context (error file only) copied!`);
  },
  copyForAISmart: (filePath: string, includeRelatedFiles: boolean) => {
    state.vscode.postMessage({
      command: "copySmartAIContext",
      filePath,
      includeRelatedFiles,
    });
    showCopyToast(
      `Smart fix context copied (${includeRelatedFiles ? "with related files" : "single file"})`,
    );
  },

  setSimpleDiagnosticMode: (enabled: boolean) => {
    if (enabled) {
      errorPriorityMode = true;
      rootCauseGrouping = true;
    } else {
      errorPriorityMode = false;
      rootCauseGrouping = false;
    }
    rerenderFocusedDiagnostics();
  },

  setErrorViewMode: (mode: string) => {
    if (mode === "priority-root") {
      errorPriorityMode = true;
      rootCauseGrouping = true;
    } else if (mode === "priority-only") {
      errorPriorityMode = true;
      rootCauseGrouping = false;
    } else {
      errorPriorityMode = false;
      rootCauseGrouping = false;
    }
    rerenderFocusedDiagnostics();
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

  toggleErrorPriorityMode: (enabled: boolean) => {
    errorPriorityMode = enabled;
    rerenderFocusedDiagnostics();
  },

  toggleRootCauseGrouping: (enabled: boolean) => {
    rootCauseGrouping = enabled;
    rerenderFocusedDiagnostics();
  },

  loadErrorDetails: (filePath: string) => {
    const containerId = `errorLines-${filePath.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const container = document.getElementById(containerId);
    if (!container) return;

    errorContainerByFile.set(filePath, containerId);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingErrorDetails.set(requestId, containerId);
    container.innerHTML =
      '<div class="error-lines-loading">Loading diagnostics...</div>';

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

  toggleCopySubmenu: (submenuId: string) => {
    const dropdown = document.getElementById("copyDropdownMenu");
    if (!(dropdown instanceof HTMLElement)) return;

    const submenu = document.getElementById(submenuId);
    if (!(submenu instanceof HTMLElement)) return;

    const shouldOpen = !submenu.classList.contains("show");
    closeCopySubmenus(dropdown);

    if (shouldOpen) {
      submenu.classList.add("show");
      const trigger = submenu.previousElementSibling;
      if (trigger instanceof HTMLElement) {
        trigger.classList.add("submenu-open");
      }
    }

    updateCopyDropdownSpace(dropdown);
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

  closeFunctionPanel: closeFunctionPanel,
  toggleFunctionPanel: toggleFunctionPanel,
  clearFileSelection: clearFileSelection,
  zoomIn: zoomIn,
  zoomOut: zoomOut,

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

function setCopyDropdownState(dropdown: HTMLElement, isOpen: boolean): void {
  const container = dropdown.closest(".copy-dropdown-container");
  if (!(container instanceof HTMLElement)) {
    dropdown.classList.toggle("show", isOpen);
    if (!isOpen) {
      closeCopySubmenus(dropdown);
    }
    return;
  }

  if (isOpen) {
    dropdown.classList.add("show");
    container.classList.add("dropdown-open");
    updateCopyDropdownSpace(dropdown);
    return;
  }

  closeCopySubmenus(dropdown);
  dropdown.classList.remove("show");
  container.classList.remove("dropdown-open");
  container.style.setProperty("--copy-dropdown-space", "0px");
}

function closeCopySubmenus(dropdown: HTMLElement): void {
  dropdown.querySelectorAll(".copy-submenu").forEach((node) => {
    if (node instanceof HTMLElement) {
      node.classList.remove("show");
    }
  });

  dropdown.querySelectorAll(".copy-sub-btn").forEach((node) => {
    if (node instanceof HTMLElement) {
      node.classList.remove("submenu-open");
    }
  });
}

function updateCopyDropdownSpace(dropdown: HTMLElement): void {
  const container = dropdown.closest(".copy-dropdown-container");
  if (!(container instanceof HTMLElement)) return;

  const dropdownSpace = dropdown.scrollHeight + 10;
  container.style.setProperty("--copy-dropdown-space", `${dropdownSpace}px`);
}

// Close dropdown when clicking outside
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
  updateDiagnosticsSummaryUi();
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

  postRoadmapCommand({ command: "roadmapWebviewReady" });
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (!isRoadmapWebviewMessage(message)) {
    return;
  }

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

  if (message.type === "roadmapDataUpdated") {
    if (!isRoadmapData(message.data)) {
      finishRefreshUi();
      return;
    }

    applyRoadmapDataUpdate(message.data);
    setupSearchControls();
    finishRefreshUi();
    return;
  }

  if (message.type === "roadmapDataRefreshFailed") {
    finishRefreshUi();
    console.error("❌ Failed to refresh roadmap data:", message.error);
    return;
  }

  if (message.type === "roadmapEmptyState") {
    showEmptyState(
      message.title || "Project roadmap",
      message.message || "No roadmap data loaded.",
      message.actionLabel,
      message.actionCommand,
    );
  }

  if (message.type === "errorDetails") {
    const containerId = pendingErrorDetails.get(message.requestId);
    pendingErrorDetails.delete(message.requestId);
    if (!containerId) return;

    const container = document.getElementById(containerId);
    if (!container) return;
    errorDetailsByFile.set(message.filePath, message.issues);
    errorContainerByFile.set(message.filePath, containerId);
    renderIssues(container, message.filePath, message.issues);
  }
});

init();










