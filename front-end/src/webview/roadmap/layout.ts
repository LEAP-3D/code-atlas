// Tree layout calculation - VERTICAL (top-to-bottom like file explorer)

import { HierarchyNode, FileNode, NodePosition } from "./types";

// Spacing configuration
const SPACING = {
  horizontal: 220,  // Хэвтээ зай (ах дүү хооронд)
  vertical: 140,    // Босоо зай (эцэг хүүхэд хооронд)
  nodeWidth: 180,   // Node-ийн өргөн
  siblingGap: 40,   // Ах дүү хоорондын нэмэлт зай
};

/**
 * Calculate width needed for a node's subtree (horizontal space)
 */
function calcSubtreeWidth(item: HierarchyNode | FileNode): number {
  if (item.type === "file") {
    return SPACING.nodeWidth;
  }

  const folder = item as HierarchyNode;
  const children = [
    ...Object.values(folder.children || {}),
    ...(folder.files || []),
  ];

  if (children.length === 0) {
    return SPACING.nodeWidth;
  }

  // Sum of all children widths + spacing between them
  const totalChildrenWidth = children.reduce(
    (sum, child) => sum + calcSubtreeWidth(child),
    0
  );
  const spacingWidth = (children.length - 1) * SPACING.siblingGap;

  return Math.max(totalChildrenWidth + spacingWidth, SPACING.nodeWidth);
}

/**
 * Calculate tree layout positions - VERTICAL (top to bottom)
 * 
 * Visual structure:
 * 
 *           [Root]
 *              │
 *     ┌────────┼────────┐
 *     │        │        │
 * [Folder1] [Folder2] [File1]
 *     │
 *  ┌──┴──┐
 *  │     │
 * [F1]  [F2]
 */
export function calculateTreeLayout(
  node: HierarchyNode,
  startX = 5000,
  startY = 200,
  level = 0
): NodePosition[] {
  const positions: NodePosition[] = [];

  const folders = Object.values(node.children || {});
  const files = node.files || [];
  const allChildren: (HierarchyNode | FileNode)[] = [...folders, ...files];

  if (allChildren.length === 0) {
    return positions;
  }

  // Calculate width for each child subtree
  const childWidths = allChildren.map(calcSubtreeWidth);
  const totalWidth = childWidths.reduce((a, b) => a + b, 0) 
    + (allChildren.length - 1) * SPACING.siblingGap;

  // Starting X position (centered under parent)
  let currentX = startX - totalWidth / 2;

  // Position each child
  allChildren.forEach((child, index) => {
    const childWidth = childWidths[index];
    const childX = currentX + childWidth / 2;
    const childY = startY + SPACING.vertical;

    // Add this child's position
    positions.push({
      node: child,
      x: childX,
      y: childY,
      level: level + 1,
      parentX: startX,
      parentY: startY,
    });

    // Recursively position this child's children
    if (child.type === "folder") {
      positions.push(
        ...calculateTreeLayout(
          child as HierarchyNode,
          childX,
          childY,
          level + 1
        )
      );
    }

    // Move X position for next sibling
    currentX += childWidth + SPACING.siblingGap;
  });

  return positions;
}