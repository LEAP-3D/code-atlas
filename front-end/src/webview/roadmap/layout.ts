// Tree layout calculation

import { HierarchyNode, FileNode, NodePosition } from "./types";

const SPACING = { h: 180, v: 250 };

/**
 * Calculate width needed for a node and its children
 */
function calcWidth(item: HierarchyNode | FileNode): number {
  if (item.type === "file") return SPACING.h;
  
  const folder = item as HierarchyNode;
  const subItems = [
    ...Object.values(folder.children || {}),
    ...(folder.files || []),
  ];
  
  if (subItems.length === 0) return SPACING.h;
  
  return Math.max(
    subItems.reduce((sum, sub) => sum + calcWidth(sub), 0),
    SPACING.h
  );
}

/**
 * Calculate tree layout positions
 */
export function calculateTreeLayout(
  node: HierarchyNode,
  startX = 5000,
  startY = 500,
  level = 0
): NodePosition[] {
  const positions: NodePosition[] = [];
  
  const folders = Object.values(node.children || {});
  const files = node.files || [];
  const allItems: (HierarchyNode | FileNode)[] = [...folders, ...files];

  if (allItems.length === 0) return positions;

  // Calculate widths for all items
  const widths = allItems.map(calcWidth);
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  let currentX = startX - totalWidth / 2;

  // Position each item
  allItems.forEach((item, i) => {
    const itemX = currentX + widths[i] / 2;
    
    positions.push({
      node: item,
      x: itemX,
      y: startY + SPACING.v,
      level: level + 1,
      parentX: startX,
      parentY: startY,
    });

    // Recursively layout folder children
    if (item.type === "folder") {
      positions.push(
        ...calculateTreeLayout(
          item as HierarchyNode,
          itemX,
          startY + SPACING.v,
          level + 1
        )
      );
    }

    currentX += widths[i];
  });

  return positions;
}