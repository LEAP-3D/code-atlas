// Node and connection rendering

import { HierarchyNode, FileNode, NodePosition } from "./types";
import * as state from "./state";
import { getNodeId, getElement } from "./utils";
import { buildHierarchy } from "./hierarchy";
import { calculateTreeLayout } from "./layout";
import { focusOnFile } from "./panel";

const HOVER_SEPARATION_X_THRESHOLD = 220;
const HOVER_SEPARATION_Y_THRESHOLD = 420;
const HOVER_SEPARATION_MAX_SHIFT = 85;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlightedName(name: string): string {
  if (!state.hasActiveSearch()) {
    return escapeHtml(name);
  }

  const query = state.searchQuery;
  if (!query) {
    return escapeHtml(name);
  }

  const parts = name.split(new RegExp(`(${escapeRegex(query)})`, "ig"));
  return parts
    .map((part) =>
      part.toLowerCase() === query
        ? `<span class="search-hit">${escapeHtml(part)}</span>`
        : escapeHtml(part),
    )
    .join("");
}

function markSearchMatches(hierarchy: HierarchyNode): void {
  state.clearSearchMatches();

  if (!state.hasActiveSearch()) {
    return;
  }

  const query = state.searchQuery;

  function visitFolder(node: HierarchyNode): boolean {
    const nodeId = getNodeId(node);
    const selfMatch = node.name.toLowerCase().includes(query);
    let subtreeHasMatch = selfMatch;

    if (selfMatch && nodeId) {
      state.setSearchMatch(nodeId);
    }

    for (const file of node.files || []) {
      const fileId = getNodeId(file);
      const fileMatch = file.name.toLowerCase().includes(query);

      if (fileMatch) {
        subtreeHasMatch = true;
        if (fileId) {
          state.setSearchMatch(fileId);
        }
      }
    }

    for (const child of Object.values(node.children || {})) {
      if (visitFolder(child)) {
        subtreeHasMatch = true;
      }
    }

    if (subtreeHasMatch && nodeId) {
      state.setSearchExpandedFolder(nodeId);
    }

    return subtreeHasMatch;
  }

  visitFolder(hierarchy);
}

/**
 * Create a DOM node element
 */
export function createNode(
  data: HierarchyNode | FileNode,
  x: number,
  y: number,
): HTMLElement {
  const node = document.createElement("div");
  node.className = `node ${data.type}`;

  if (data.type === "file" && (data as FileNode).errorCount > 0) {
    node.classList.add("has-error");
  }

  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.transform =
    "translate(-50%, -50%) translate(var(--hover-shift-x, 0px), var(--hover-shift-y, 0px))";

  const nodeId = getNodeId(data) || "";
  node.dataset.id = nodeId;

  const icon = data.type === "folder" ? "📁" : "📄";

  const errorInd =
    data.type === "file" && (data as FileNode).errorCount > 0
      ? '<div class="error-badge-indicator">!</div>'
      : "";

  // Folder expanded indicator
  const isExpanded = data.type === "folder" && state.isFolderExpanded(nodeId);
  const expandIcon = data.type === "folder" 
    ? `<div class="expand-indicator">${isExpanded ? "▼" : "▶"}</div>` 
    : "";

  node.innerHTML = `
    <div class="node-circle">
      ${errorInd}
      ${expandIcon}
      <div class="node-icon">${icon}</div>
      <div class="node-name">${renderHighlightedName(data.name)}</div>
    </div>
  `;

  if (state.hasActiveSearch()) {
    node.classList.add(state.isSearchMatch(nodeId) ? "search-match" : "search-dimmed");
  }

  node.addEventListener("mouseenter", () => {
    applyHoverNodeSeparation(node);
  });

  node.addEventListener("mouseleave", () => {
    clearHoverNodeSeparation();
  });

  // Add click handler for files
  if (data.type === "file") {
    node.onclick = (e) => {
      e.stopPropagation();
      focusOnFile(data as FileNode);
    };
  }

  // Add click handler for folders - toggle expand
  if (data.type === "folder") {
    node.style.cursor = "pointer";
    node.onclick = (e) => {
      e.stopPropagation();
      state.toggleFolderExpanded(nodeId);
      renderGraph();
    };
  }

  return node;
}

function clearHoverNodeSeparation(): void {
  state.allNodes.forEach(({ element }) => {
    element.style.removeProperty("--hover-shift-x");
    element.style.removeProperty("--hover-shift-y");
    element.classList.remove("hover-neighbor", "hover-active-node");
  });
}

function applyHoverNodeSeparation(activeElement: HTMLElement): void {
  clearHoverNodeSeparation();

  const active = state.allNodes.find((n) => n.element === activeElement);
  if (!active) {
    return;
  }

  active.element.classList.add("hover-active-node");

  state.allNodes.forEach((candidate) => {
    if (candidate.element === activeElement) {
      return;
    }

    const dx = Math.abs(candidate.x - active.x);
    const dy = candidate.y - active.y;
    const absDy = Math.abs(dy);

    if (dx > HOVER_SEPARATION_X_THRESHOLD || absDy > HOVER_SEPARATION_Y_THRESHOLD) {
      return;
    }

    const proximity = 1 - absDy / HOVER_SEPARATION_Y_THRESHOLD;
    const shift = Math.round(
      Math.max(0, Math.min(HOVER_SEPARATION_MAX_SHIFT, proximity * HOVER_SEPARATION_MAX_SHIFT)),
    );

    if (shift <= 0) {
      return;
    }

    candidate.element.style.setProperty(
      "--hover-shift-y",
      `${dy < 0 ? -shift : shift}px`,
    );
    candidate.element.classList.add("hover-neighbor");
  });
}

/**
 * Draw VERTICAL tree connection
 */
export function drawConnection(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  childId: string,
  parentId: string | null,
): void {
  const svg = getElement<SVGSVGElement>("connectionsSvg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

  const isFile = childId.startsWith("file-");

  if (isFile) {
    const midY = y1 + Math.min(80, Math.max(42, (y2 - y1) * 0.35));
    path.setAttribute("d", `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`);
  } else if (Math.abs(x1 - x2) < 5) {
    path.setAttribute("d", `M ${x1} ${y1} L ${x2} ${y2}`);
  } else {
    const midY = y1 + 50;
    path.setAttribute(
      "d",
      `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`,
    );
  }

  path.classList.add("connection-line");
  path.dataset.childId = childId;
  path.dataset.parentId = parentId || "";

  svg.appendChild(path);
  state.addConnection({ line: path, childId, parentId });
}

/**
 * Render the complete graph
 */
export function renderGraph(): void {
  const nodesContainer = getElement<HTMLDivElement>("nodesContainer");
  const svg = getElement<SVGSVGElement>("connectionsSvg");

  // Clear existing
  nodesContainer.innerHTML = "";
  svg.innerHTML = "";
  clearHoverNodeSeparation();
  state.clearRenderState();

  // Build hierarchy
  const hierarchy = buildHierarchy(state.roadmapData.files);
  state.setHierarchyData(hierarchy);
  markSearchMatches(hierarchy);

  // Calculate layout
  const positions = calculateTreeLayout(hierarchy);

  // Render root node (at top center)
  const rootEl = createNode(hierarchy, 5000, 200);
  nodesContainer.appendChild(rootEl);
  state.addNode({ element: rootEl, data: hierarchy, x: 5000, y: 200 });

  // Draw connections first (so they're behind nodes)
  positions.forEach((pos: NodePosition) => {
    if (pos.parentX !== undefined) {
      drawConnection(
        pos.parentX,
        pos.parentY!,
        pos.x,
        pos.y,
        getNodeId(pos.node) || "",
        getNodeId(pos.node.parent),
      );
    }
  });

  // Render all other nodes
  positions.forEach((pos: NodePosition) => {
    const el = createNode(pos.node, pos.x, pos.y);
    nodesContainer.appendChild(el);
    state.addNode({ element: el, data: pos.node, x: pos.x, y: pos.y });
  });

  console.log("✅ Rendered", state.allNodes.length, "nodes");
}
