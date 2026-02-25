// Tree layout calculation - VERTICAL (top-to-bottom like file explorer)

import { HierarchyNode, FileNode, NodePosition } from "./types";
import * as state from "./state";
import { getNodeId } from "./utils";

// Spacing configuration
const SPACING = {
  horizontal: 430,
  vertical: 290,
  nodeWidth: 240,
  siblingGap: 150,
  fileVerticalGap: 300, // File хоорондын босоо зай
  folderAfterFilesGap: 360, // Parent file block-ийн дараах folder row gap
};

/**
 * Calculate width needed for a node's subtree (horizontal space)
 */
function calcSubtreeWidth(item: HierarchyNode | FileNode): number {
  if (item.type === "file") {
    return SPACING.nodeWidth;
  }

  const folder = item as HierarchyNode;
  const childFolders = Object.values(folder.children || {}).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const files = [...(folder.files || [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  if (childFolders.length === 0 && files.length === 0) {
    return SPACING.nodeWidth;
  }

  let foldersWidth = 0;
  if (childFolders.length > 0) {
    const folderWidths = childFolders.map((child) => calcSubtreeWidth(child));
    foldersWidth =
      folderWidths.reduce((sum, w) => sum + w, 0) +
      (childFolders.length - 1) * SPACING.siblingGap;
  }

  // Files are rendered centered under the parent folder, so they don't need
  // extra horizontal column width.
  const filesWidth = files.length > 0 ? SPACING.nodeWidth : 0;

  return Math.max(foldersWidth, filesWidth, SPACING.nodeWidth);
}

export function calculateTreeLayout(
  node: HierarchyNode,
  startX = 5000,
  startY = 250,
  level = 0,
): NodePosition[] {
  const positions: NodePosition[] = [];

  const folders = Object.values(node.children || {}).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const files = [...(node.files || [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const folderId = getNodeId(node);
  const isExpanded = folderId ? state.isFolderExpanded(folderId) : false;

  const firstFileY = startY + SPACING.vertical;
  const lastFileY =
    firstFileY + Math.max(0, files.length - 1) * SPACING.fileVerticalGap;
  const foldersStartY =
    isExpanded && files.length > 0
      ? lastFileY + SPACING.folderAfterFilesGap
      : startY + SPACING.vertical;

  // Handle folders - spread HORIZONTALLY on a dedicated row below file block
  if (folders.length > 0) {
    const folderWidths = folders.map((f) => calcSubtreeWidth(f));
    const totalWidth =
      folderWidths.reduce((a, b) => a + b, 0) +
      (folders.length - 1) * SPACING.siblingGap;

    let currentX = startX - totalWidth / 2;

    folders.forEach((folder, index) => {
      const folderWidth = folderWidths[index];
      const folderX = currentX + folderWidth / 2;

      positions.push({
        node: folder,
        x: folderX,
        y: foldersStartY,
        level: level + 1,
        parentX: startX,
        parentY: startY,
      });

      positions.push(
        ...calculateTreeLayout(folder, folderX, foldersStartY, level + 1),
      );

      currentX += folderWidth + SPACING.siblingGap;
    });
  }

  // Handle files - centered directly under parent folder
  if (isExpanded && files.length > 0) {
    files.forEach((file, index) => {
      const fileY = firstFileY + index * SPACING.fileVerticalGap;

      positions.push({
        node: file,
        x: startX,
        y: fileY,
        level: level + 1,
        parentX: startX,
        parentY: startY,
      });
    });
  }

  return positions;
}
