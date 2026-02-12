// Tree layout calculation - VERTICAL (top-to-bottom like file explorer)
// UPDATED: Adjusted spacing for larger, more readable nodes

import { HierarchyNode, FileNode, NodePosition } from "./types";

// Spacing configuration - UPDATED for larger nodes
const SPACING = {
  horizontal: 280, // Increased from 220 - more space between siblings
  vertical: 200, // Increased from 150 - more vertical space
  nodeWidth: 240, // Increased from 180 - account for larger circles
  siblingGap: 60, // Increased from 40 - more gap between siblings
};

/**
 * Calculate width needed for a node's subtree (horizontal space)
 */
function calcSubtreeWidth(item: HierarchyNode | FileNode): number {
  if (item.type === "file") {
    return SPACING.nodeWidth;
  }

  const folder = item as HierarchyNode;
  const childFolders = Object.values(folder.children || {});
  const files = folder.files || [];

  // If no children at all
  if (childFolders.length === 0 && files.length === 0) {
    return SPACING.nodeWidth;
  }

  // Calculate width for child folders (they spread horizontally)
  let foldersWidth = 0;
  if (childFolders.length > 0) {
    const folderWidths = childFolders.map((child) => calcSubtreeWidth(child));
    foldersWidth =
      folderWidths.reduce((sum, w) => sum + w, 0) +
      (childFolders.length - 1) * SPACING.siblingGap;
  }

  // Files stack vertically (need width for indented column)
  const filesWidth = files.length > 0 ? SPACING.nodeWidth + 200 : 0;

  // Total width is the MAXIMUM (folders and files don't add, they overlap vertically)
  return Math.max(foldersWidth, filesWidth, SPACING.nodeWidth);
}

export function calculateTreeLayout(
  node: HierarchyNode,
  startX = 5000,
  startY = 250, // Increased from 200 for larger root node
  level = 0,
): NodePosition[] {
  const positions: NodePosition[] = [];

  const folders = Object.values(node.children || {});
  const files = node.files || [];

  // Handle folders - spread HORIZONTALLY
  if (folders.length > 0) {
    const folderWidths = folders.map(calcSubtreeWidth);
    const totalWidth =
      folderWidths.reduce((a, b) => a + b, 0) +
      (folders.length - 1) * SPACING.siblingGap;

    let currentX = startX - totalWidth / 2;
    const folderY = startY + SPACING.vertical;

    folders.forEach((folder, index) => {
      const folderWidth = folderWidths[index];
      const folderX = currentX + folderWidth / 2;

      positions.push({
        node: folder,
        x: folderX,
        y: folderY,
        level: level + 1,
        parentX: startX,
        parentY: startY,
      });

      // Recursively position folder's children
      positions.push(
        ...calculateTreeLayout(folder, folderX, folderY, level + 1),
      );

      currentX += folderWidth + SPACING.siblingGap;
    });
  }

  // Handle files - stack VERTICALLY with RIGHT INDENT (tree command style)
  if (files.length > 0) {
    const firstFileY = startY + SPACING.vertical;

    if (files.length === 1) {
      // Single file - connect STRAIGHT DOWN (no indent)
      const fileX = startX;
      const fileY = firstFileY;

      positions.push({
        node: files[0],
        x: fileX,
        y: fileY,
        level: level + 1,
        parentX: startX,
        parentY: startY,
      });
    } else {
      // Multiple files - indent RIGHT with tree structure
      const fileX = startX + 200; // Increased indent for larger nodes

      files.forEach((file, index) => {
        const fileY = firstFileY + index * 220; // Increased from 160 for much more spacing between files

        positions.push({
          node: file,
          x: fileX,
          y: fileY,
          level: level + 1,
          parentX: startX,
          parentY: startY,
        });
      });
    }
  }

  return positions;
}
