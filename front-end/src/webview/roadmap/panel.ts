// Function panel management

import { FileNode, HierarchyNode, RoadmapDependency } from "./types";
import * as state from "./state";
import { getNodeId, getFunctionIcon, getElement } from "./utils";
import { findFileNodeByPath } from "./hierarchy";
import { updateTransform } from "./interactions";

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

  // Error warning
  const errWarn =
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

  header.innerHTML = `
    <div class="function-panel-title">📄 ${fileData.name}</div>
    <div class="function-panel-subtitle">${fileData.functions?.length || 0} functions</div>
    ${errWarn}
  `;

  // Dependencies section
  const depsSection = `
    <div class="dependencies-section">
      <div class="section-title">🔗 Dependencies</div>
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
                <div class="dep-file-name">${d.importedFilePath.split("/").pop()}</div>
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
                <div class="dep-file-name">${d.importerFilePath.split("/").pop()}</div>
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
      ${imports.length === 0 && importedBy.length === 0 ? '<div class="no-deps">No dependencies</div>' : ""}
    </div>
  `;

  // Functions section
  const funcSection = `
    <div class="functions-section">
      <div class="section-title">⚡ Functions (${fileData.functions?.length || 0})</div>
      ${
        fileData.functions
          ?.map(
            (fn) => `
        <div class="function-card" onclick="window.roadmapActions.goToFunction('${fileData.fullPath.replace(/\\/g, "\\\\")}', ${fn.startLine || 1})">
          <div class="function-icon">${getFunctionIcon(fn.name)}</div>
          <div class="function-details">
            <div class="function-name">${fn.name}</div>
            <div class="function-meta">${fn.startLine ? `Line ${fn.startLine}` : ""}${fn.calls && fn.calls.length > 0 ? ` • Calls: ${fn.calls.slice(0, 2).join(", ")}${fn.calls.length > 2 ? "..." : ""}` : ""}</div>
          </div>
          <div class="function-goto">→</div>
        </div>
      `,
          )
          .join("") || '<p style="color:#666;padding:12px">No functions</p>'
      }
    </div>
  `;

  list.innerHTML = depsSection + funcSection;
  panel.classList.add("visible");
}

/**
 * Close the function panel
 */
export function closeFunctionPanel(): void {
  getElement<HTMLDivElement>("functionPanel").classList.remove("visible");
}

/**
 * Focus on a specific file
 */
export function focusOnFile(fileData: FileNode): void {
  console.log("🎯 Focus:", fileData.name);
  state.setFocusedFile(fileData);

  const relevantNodeIds = new Set<string>();
  const dependencyNodeIds = new Set<string>();

  // Add current file
  const currentId = getNodeId(fileData);
  if (currentId) relevantNodeIds.add(currentId);

  // Add parent path
  let current: HierarchyNode | null = fileData.parent;
  while (current && current.name !== "Root") {
    const id = getNodeId(current);
    if (id) relevantNodeIds.add(id);
    current = current.parent;
  }

  // Find dependencies
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

  // Add dependency nodes
  imports.forEach((dep) => {
    if (state.hierarchyData) {
      const node = findFileNodeByPath(
        state.hierarchyData,
        dep.importedFilePath,
      );
      if (node) {
        const id = getNodeId(node);
        if (id) dependencyNodeIds.add(id);
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
        if (id) dependencyNodeIds.add(id);
      }
    }
  });

  // Update node styles
  state.allNodes.forEach((nodeObj) => {
    const nodeId = getNodeId(nodeObj.data);
    const isFile = nodeId === getNodeId(fileData);
    const isInPath = nodeId && relevantNodeIds.has(nodeId) && !isFile;
    const isDep = nodeId && dependencyNodeIds.has(nodeId);

    nodeObj.element.classList.remove(
      "focused",
      "dimmed",
      "small",
      "dependency",
    );

    if (isFile) nodeObj.element.classList.add("focused");
    else if (isDep) nodeObj.element.classList.add("dependency");
    else if (isInPath) nodeObj.element.classList.add("small");
    else nodeObj.element.classList.add("dimmed");
  });

  // Update connection styles
  state.connections.forEach(({ line, childId, parentId }) => {
    const bothInPath =
      relevantNodeIds.has(childId) && parentId && relevantNodeIds.has(parentId);
    const childIsDep = dependencyNodeIds.has(childId);
    const parentIsDep = parentId && dependencyNodeIds.has(parentId);
    const connectsToDep =
      (childId === getNodeId(fileData) && parentIsDep) ||
      (parentId === getNodeId(fileData) && childIsDep) ||
      (childIsDep && parentId && relevantNodeIds.has(parentId)) ||
      (parentIsDep && relevantNodeIds.has(childId));

    line.classList.remove("highlight", "dependency-line");

    if (bothInPath) line.classList.add("highlight");
    else if (connectsToDep) line.classList.add("dependency-line");
  });

  // Show panel
  showFunctionPanel(fileData);

  // Update breadcrumb
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
    focusOnFile(node);

    // Center view on node
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
  }
}

/**
 * Update breadcrumb text
 */
export function updateBreadcrumb(text: string): void {
  getElement<HTMLDivElement>("breadcrumb").innerHTML =
    `<span class="breadcrumb-item" onclick="window.roadmapActions.resetView()">${text}</span>`;
}
