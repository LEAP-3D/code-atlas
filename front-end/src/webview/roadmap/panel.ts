// Function panel management

import { FileNode, HierarchyNode, RoadmapDependency } from "./types";
import * as state from "./state";
import { getNodeId, getFunctionIcon, getElement } from "./utils";
import { findFileNodeByPath } from "./hierarchy";
import { updateTransform } from "./interactions";
import { renderGraph } from "./renderer";

let panelToggleOpeningTimer: number | null = null;
const fileNavigationHistory: string[] = [];

/**
 * Show function panel for a file
 */
export function showFunctionPanel(fileData: FileNode): void {
  const panel = getElement<HTMLDivElement>("functionPanel");
  const header = getElement<HTMLDivElement>("panelHeader");
  const list = getElement<HTMLDivElement>("functionList");

  const deps: RoadmapDependency[] = state.roadmapData.dependencies || [];
  const imports = deps.filter(
    (d: RoadmapDependency) => d.importerFilePath === fileData.fullPath,
  );
  const importedBy = deps.filter(
    (d: RoadmapDependency) => d.importedFilePath === fileData.fullPath,
  );

  const copyButtons = `
    <div class="copy-dropdown-container">
      <button class="copy-main-btn" onclick="event.stopPropagation(); window.roadmapActions.toggleCopyDropdown()">
        <span class="copy-main-icon">📋</span>
        <span class="copy-main-text">Copy</span>
        <span class="copy-main-arrow">▼</span>
      </button>
      <div class="copy-dropdown-menu" id="copyDropdownMenu">
        <div class="copy-dropdown-item" onclick="event.stopPropagation(); window.roadmapActions.copyFile('${fileData.fullPath.replace(/\\/g, "\\\\")}'); window.roadmapActions.closeCopyDropdown();">
          <span class="copy-dropdown-icon">📄</span>
          <span class="copy-dropdown-text">This file only</span>
        </div>
        <div class="copy-dropdown-item" onclick="event.stopPropagation(); window.roadmapActions.copyAll('${fileData.fullPath.replace(/\\/g, "\\\\")}'); window.roadmapActions.closeCopyDropdown();">
          <span class="copy-dropdown-icon">📦</span>
          <span class="copy-dropdown-text">With imports/exports</span>
        </div>
      </div>
    </div>
  `;

  // ✅ Error warning banner (like before) - at the top
  const errorBanner =
    fileData.errorCount > 0
      ? `
      <div class="error-warning" onclick="window.roadmapActions.debugExecutionFlow('${fileData.fullPath.replace(/\\/g, "\\\\")}')">
        <div class="error-warning-icon">⚠️</div>
        <div class="error-warning-text">
          <div class="error-warning-title">${fileData.errorCount} Error${fileData.errorCount > 1 ? "s" : ""} Detected</div>
          <div class="error-warning-subtitle">Click to debug execution flow →</div>
        </div>
        <button class="error-debug-btn" onclick="event.stopPropagation(); window.roadmapActions.debugExecutionFlow('${fileData.fullPath.replace(/\\/g, "\\\\")}')">
          🐛 Debug
        </button>
      </div>`
      : "";

  const backButton =
    fileNavigationHistory.length > 0
      ? `<button class="panel-back-btn" onclick="event.stopPropagation(); window.roadmapActions.goBackInPanel()">< Back</button>`
      : "";

  header.innerHTML = `
    <div class="file-header-row">
      ${backButton}
      <div class="file-header-minimal">
        <div class="file-header-name">${fileData.name}</div>
        <div class="file-header-meta">${fileData.functions?.length || 0} functions</div>
      </div>
    </div>
    ${copyButtons}
  `;

  // ✅ Collapsible Errors section (like Functions/Dependencies)
  const errorSection = `
      <div class="error-section">
        <div class="section-header" onclick="window.roadmapActions.toggleSection('errors')">
          <div class="section-title">
            <span class="section-icon">⚠️</span>
            <span>Errors & Warnings</span>
            <span class="section-count error-count">${fileData.errorCount}</span>
          </div>
          <span class="section-toggle" id="errors-toggle">▼</span>
        </div>
        <div class="section-content" id="errors-content">
          <div class="error-mode-controls">
            <label class="diag-simple-toggle">
              <input type="checkbox" checked onchange="window.roadmapActions.setSimpleDiagnosticMode(this.checked)" />
              <span class="diag-simple-copy">
                <span class="diag-simple-title">First fix these</span>
                <span class="diag-simple-hint">Show root causes first, then line-by-line errors</span>
              </span>
            </label>
          </div>
          <div class="error-lines-container" id="errorLines-${fileData.fullPath.replace(/[^a-zA-Z0-9]/g, "_")}">
            <div class="error-lines-loading">Loading diagnostics...</div>
          </div>
        </div>
      </div>`;

  // ✅ ORDER: Errors FIRST, then Functions, then Dependencies
  const funcSection = `
    <div class="functions-section">
      <div class="section-header" onclick="window.roadmapActions.toggleSection('funcs')">
        <div class="section-title">
          <span class="section-icon">⚡</span>
          <span>Functions</span>
          <span class="section-count">${fileData.functions?.length || 0}</span>
        </div>
        <span class="section-toggle" id="funcs-toggle">▼</span>
      </div>
      <div class="section-content" id="funcs-content">
        ${
          fileData.functions
            ?.map(
              (fn) => `
          <div class="function-card" onclick="window.roadmapActions.goToFunction('${fileData.fullPath.replace(/\\/g, "\\\\")}', ${fn.startLine || 1})">
            <div class="function-icon">${getFunctionIcon(fn.name)}</div>
            <div class="function-details">
              <div class="function-name">${fn.name}</div>
              <div class="function-meta">${fn.startLine ? `Line ${fn.startLine}` : ""}${fn.calls && fn.calls.length > 0 ? ` • ${fn.calls.length} calls` : ""}</div>
            </div>
            <div class="function-goto">→</div>
          </div>
        `,
            )
            .join("") || '<p class="no-content">No functions</p>'
        }
      </div>
    </div>
  `;

  // ✅ Dependencies THIRD (доор байна)
  const depsSection = `
    <div class="dependencies-section">
      <div class="section-header" onclick="window.roadmapActions.toggleSection('deps')">
        <div class="section-title">
          <span class="section-icon">🔗</span>
          <span>Dependencies</span>
          <span class="section-count">${imports.length + importedBy.length}</span>
        </div>
        <span class="section-toggle" id="deps-toggle">▼</span>
      </div>
      <div class="section-content" id="deps-content">
        ${
          imports.length > 0
            ? `
          <div class="dep-subsection">
            <div class="dep-subtitle">📥 Imports (${imports.length})</div>
            ${imports
              .map(
                (d) => `
              <div class="dep-item" onclick="window.roadmapActions.jumpToFile('${d.importedFilePath.replace(/\\/g, "\\\\")}')">
                <div class="dep-icon">📄</div>
                <div class="dep-details">
                  <div class="dep-file-name">${d.importedFilePath.split(/[/\\]/).pop()}</div>
                  <div class="dep-imported-names">${d.importedNames.join(", ")}</div>
                </div>
                <div class="dep-arrow">→</div>
              </div>
            `,
              )
              .join("")}
          </div>`
            : ""
        }
        ${
          importedBy.length > 0
            ? `
          <div class="dep-subsection">
            <div class="dep-subtitle">📤 Imported by (${importedBy.length})</div>
            ${importedBy
              .map(
                (d) => `
              <div class="dep-item" onclick="window.roadmapActions.jumpToFile('${d.importerFilePath.replace(/\\/g, "\\\\")}')">
                <div class="dep-icon">📄</div>
                <div class="dep-details">
                  <div class="dep-file-name">${d.importerFilePath.split(/[/\\]/).pop()}</div>
                  <div class="dep-imported-names">${d.importedNames.join(", ")}</div>
                </div>
                <div class="dep-arrow">→</div>
              </div>
            `,
              )
              .join("")}
          </div>`
            : ""
        }
        ${imports.length === 0 && importedBy.length === 0 ? '<div class="no-content">No dependencies</div>' : ""}
      </div>
    </div>
  `;

  // ✅ ORDER: Errors section, Functions, Dependencies, Error banner
  list.innerHTML = errorSection + funcSection + depsSection + errorBanner;
  panel.classList.add("visible");
  const toggle = getElement<HTMLButtonElement>("panelToggle");
  const wasActive = toggle.classList.contains("active");
  toggle.classList.add("active", "panel-open");

  // First reveal: delay chevron visibility so it aligns with panel slide-in.
  if (!wasActive) {
    toggle.classList.add("opening");
    if (panelToggleOpeningTimer !== null) {
      window.clearTimeout(panelToggleOpeningTimer);
    }
    panelToggleOpeningTimer = window.setTimeout(() => {
      toggle.classList.remove("opening");
      panelToggleOpeningTimer = null;
    }, 260);
  }

  setTimeout(() => {
    window.roadmapActions.loadErrorDetails(fileData.fullPath);
  }, 100);
}

/**
 * Hide panel UI only (keep file focus/highlight state)
 */
export function closeFunctionPanel(): void {
  getElement<HTMLDivElement>("functionPanel").classList.remove("visible");
  const toggle = getElement<HTMLButtonElement>("panelToggle");
  if (toggle.classList.contains("active")) {
    toggle.classList.remove("panel-open");
  }
}

/**
 * Toggle panel visibility while keeping current selection/highlights
 */
export function toggleFunctionPanel(): void {
  const panel = getElement<HTMLDivElement>("functionPanel");
  const toggle = getElement<HTMLButtonElement>("panelToggle");

  if (!toggle.classList.contains("active")) {
    return;
  }

  const isOpen = panel.classList.contains("visible");
  if (isOpen) {
    closeFunctionPanel();
  } else {
    panel.classList.add("visible");
    toggle.classList.add("panel-open");
  }
}

/**
 * Clear selected file context (panel + highlights + focused state)
 */
export function clearFileSelection(): void {
  state.setFocusedFile(null);
  fileNavigationHistory.length = 0;

  state.allNodes.forEach((nodeObj) => {
    nodeObj.element.classList.remove(
      "focused",
      "dimmed",
      "small",
      "dependency",
      "dependency-folder",
      "import-dep",
      "imported-by-dep",
      "import-folder",
      "imported-by-folder",
    );
  });

  state.connections.forEach(({ line }) => {
    line.classList.remove(
      "highlight",
      "dependency-line",
      "dependency-folder-line",
      "import-line",
      "imported-by-line",
      "import-folder-line",
      "imported-by-folder-line",
    );
  });

  closeFunctionPanel();
  const toggle = getElement<HTMLButtonElement>("panelToggle");
  toggle.classList.remove("active", "panel-open", "opening");
  if (panelToggleOpeningTimer !== null) {
    window.clearTimeout(panelToggleOpeningTimer);
    panelToggleOpeningTimer = null;
  }
  updateBreadcrumb("Full Map");
}

/**
 * Update breadcrumb text
 */
export function updateBreadcrumb(text: string): void {
  getElement<HTMLDivElement>("breadcrumb").innerHTML =
    `<span class="breadcrumb-item" onclick="window.roadmapActions.resetView()">${text}</span>`;
}

/**
 * Focus on a specific file
 */
export function focusOnFile(fileData: FileNode): void {
  console.log("🎯 Focus:", fileData.name);
  state.setFocusedFile(fileData);

  const relevantNodeIds = new Set<string>();
  const importNodeIds = new Set<string>();
  const importedByNodeIds = new Set<string>();
  const importFolderIds = new Set<string>();
  const importedByFolderIds = new Set<string>();
  const importPathNodeIds = new Set<string>();
  const importedByPathNodeIds = new Set<string>();
  let needsRerender = false;

  const markPathToRoot = (
    startNode: FileNode | HierarchyNode,
    pathNodeIds: Set<string>,
    folderIds: Set<string>,
  ): void => {
    let pathCursor: FileNode | HierarchyNode | null = startNode;
    while (pathCursor && pathCursor.name !== "Root") {
      const pathId = getNodeId(pathCursor);
      if (pathId) {
        pathNodeIds.add(pathId);
        if (pathCursor.type === "folder") {
          folderIds.add(pathId);
        }
      }
      if (pathCursor.parent) {
        const pathParentId = getNodeId(pathCursor.parent);
        if (pathParentId && !state.isFolderExpanded(pathParentId)) {
          state.expandedFolders.add(pathParentId);
          needsRerender = true;
        }
      }
      pathCursor = pathCursor.parent;
    }
  };

  const currentId = getNodeId(fileData);
  if (currentId) relevantNodeIds.add(currentId);

  if (fileData.parent) {
    const parentId = getNodeId(fileData.parent);
    if (parentId) {
      if (!state.isFolderExpanded(parentId)) {
        state.expandedFolders.add(parentId);
        needsRerender = true;
      }
    }
  }

  let current: HierarchyNode | null = fileData.parent;
  while (current && current.name !== "Root") {
    const id = getNodeId(current);
    if (id) relevantNodeIds.add(id);
    current = current.parent;
  }

  const deps: RoadmapDependency[] = state.roadmapData.dependencies || [];
  const imports = deps.filter(
    (d: RoadmapDependency) => d.importerFilePath === fileData.fullPath,
  );
  const importedBy = deps.filter(
    (d: RoadmapDependency) => d.importedFilePath === fileData.fullPath,
  );

  console.log(
    "  📥 Imports:",
    imports.length,
    "📤 ImportedBy:",
    importedBy.length,
  );

  imports.forEach((dep) => {
    if (state.hierarchyData) {
      const node = findFileNodeByPath(
        state.hierarchyData,
        dep.importedFilePath,
      );
      if (node) {
        const id = getNodeId(node);
        if (id) importNodeIds.add(id);
        markPathToRoot(node, importPathNodeIds, importFolderIds);
      }
    }
  });

  importedBy.forEach((dep) => {
    if (state.hierarchyData) {
      const node = findFileNodeByPath(
        state.hierarchyData,
        dep.importerFilePath,
      );
      if (node) {
        const id = getNodeId(node);
        if (id) importedByNodeIds.add(id);
        markPathToRoot(node, importedByPathNodeIds, importedByFolderIds);
      }
    }
  });

  if (needsRerender) {
    renderGraph();
  }

  state.allNodes.forEach((nodeObj) => {
    const nodeId = getNodeId(nodeObj.data);
    const isFile = nodeId === getNodeId(fileData);
    const isInPath = nodeId && relevantNodeIds.has(nodeId) && !isFile;
    const isImport = nodeId && importNodeIds.has(nodeId);
    const isImportedBy = nodeId && importedByNodeIds.has(nodeId);
    const isImportFolder = nodeId && importFolderIds.has(nodeId);
    const isImportedByFolder = nodeId && importedByFolderIds.has(nodeId);

    nodeObj.element.classList.remove(
      "focused",
      "dimmed",
      "small",
      "dependency",
      "dependency-folder",
      "import-dep",
      "imported-by-dep",
      "import-folder",
      "imported-by-folder",
    );

    if (isFile) {
      nodeObj.element.classList.add("focused");
    } else if (isImport) {
      nodeObj.element.classList.add("import-dep");
    } else if (isImportedBy) {
      nodeObj.element.classList.add("imported-by-dep");
    } else if (isImportFolder) {
      nodeObj.element.classList.add("import-folder");
    } else if (isImportedByFolder) {
      nodeObj.element.classList.add("imported-by-folder");
    } else if (isInPath) {
      nodeObj.element.classList.add("small");
    } else {
      nodeObj.element.classList.add("dimmed");
    }
  });

  state.connections.forEach(({ line, childId, parentId }) => {
    const bothInPath =
      relevantNodeIds.has(childId) && parentId && relevantNodeIds.has(parentId);

    const isImportLine =
      importNodeIds.has(childId) || (parentId && importNodeIds.has(parentId));
    const isImportedByLine =
      importedByNodeIds.has(childId) ||
      (parentId && importedByNodeIds.has(parentId));
    const isImportFolderLine =
      importPathNodeIds.has(childId) &&
      Boolean(parentId && importPathNodeIds.has(parentId));
    const isImportedByFolderLine =
      importedByPathNodeIds.has(childId) &&
      Boolean(parentId && importedByPathNodeIds.has(parentId));

    line.classList.remove(
      "highlight",
      "dependency-line",
      "dependency-folder-line",
      "import-line",
      "imported-by-line",
      "import-folder-line",
      "imported-by-folder-line",
    );

    if (bothInPath) {
      line.classList.add("highlight");
    } else if (isImportLine) {
      line.classList.add("import-line");
    } else if (isImportedByLine) {
      line.classList.add("imported-by-line");
    } else if (isImportFolderLine) {
      line.classList.add("import-folder-line");
    } else if (isImportedByFolderLine) {
      line.classList.add("imported-by-folder-line");
    }
  });

  showFunctionPanel(fileData);

  const pathParts: string[] = [];
  let pathNode: FileNode | HierarchyNode | null = fileData;
  while (pathNode) {
    pathParts.unshift(pathNode.name);
    pathNode = pathNode.parent;
  }
  updateBreadcrumb(pathParts.join(" / "));
}

/**
 * Jump to a file by path
 */
export function jumpToFile(filePath: string): void {
  console.log("🎯 Jump to:", filePath);

  if (!state.hierarchyData) return;

  const node = findFileNodeByPath(state.hierarchyData, filePath);
  if (node) {
    const currentPath = state.focusedFile?.fullPath;
    if (
      currentPath &&
      currentPath !== filePath &&
      fileNavigationHistory[fileNavigationHistory.length - 1] !== currentPath
    ) {
      fileNavigationHistory.push(currentPath);
    }

    focusOnFile(node);

    setTimeout(() => {
      const nodeObj = state.allNodes.find(
        (n) => getNodeId(n.data) === getNodeId(node),
      );
      if (nodeObj) {
        const canvas = getElement<HTMLDivElement>("canvas");
        const rect = canvas.getBoundingClientRect();
        state.setTranslate(
          rect.width / 2 - (nodeObj.x - 5000) * state.scale,
          rect.height / 2 - (nodeObj.y - 5000) * state.scale,
        );
        updateTransform();
      }
    }, 50);
  }
}

export function goBackInPanel(): void {
  if (!state.hierarchyData || fileNavigationHistory.length === 0) {
    return;
  }

  const previousPath = fileNavigationHistory.pop();
  if (!previousPath) {
    return;
  }

  const node = findFileNodeByPath(state.hierarchyData, previousPath);
  if (!node) {
    return;
  }

  focusOnFile(node);
}
