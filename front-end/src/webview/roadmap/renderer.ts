// Node and connection rendering

import { HierarchyNode, FileNode, NodePosition } from "./types";
import * as state from "./state";
import { getNodeId, countFiles, getElement } from "./utils";
import { buildHierarchy } from "./hierarchy";
import { calculateTreeLayout } from "./layout";
import { focusOnFile } from "./panel";

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
  node.style.transform = "translate(-50%, -50%)";

  const icon = data.type === "folder" ? "📁" : "📄";
  const badge =
    data.type === "folder"
      ? countFiles(data as HierarchyNode)
      : (data as FileNode).functions?.length || 0;

  const errorInd =
    data.type === "file" && (data as FileNode).errorCount > 0
      ? '<div class="error-badge-indicator">!</div>'
      : "";

  node.innerHTML = `
    <div class="node-circle">
      ${errorInd}
      ${badge > 0 ? `<div class="node-badge">${badge}</div>` : ""}
      <div class="node-icon">${icon}</div>
      <div class="node-name">${data.name}</div>
    </div>
  `;

  // Add click handler for files
  if (data.type === "file") {
    node.onclick = (e) => {
      e.stopPropagation();
      focusOnFile(data as FileNode);
    };
  }

  return node;
}

/**
 * Draw VERTICAL tree connection (top-to-bottom)
 * Creates proper tree trunk with branches like: ├── └──
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

  // Detect if child is indented right (file)
  const isFile = x2 > x1 + 100;

  if (isFile) {
    // FILE CONNECTION: Create ├── style branch
    // Vertical trunk from parent, horizontal branch at FILE height, then to file
    path.setAttribute("d", `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`);
  } else if (Math.abs(x1 - x2) < 5) {
    // Straight vertical line (folder to folder)
    path.setAttribute("d", `M ${x1} ${y1} L ${x2} ${y2}`);
  } else {
    // FOLDER CONNECTION: horizontal spread
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
  state.clearRenderState();

  // Build hierarchy
  const hierarchy = buildHierarchy(state.roadmapData.files);
  state.setHierarchyData(hierarchy);

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
