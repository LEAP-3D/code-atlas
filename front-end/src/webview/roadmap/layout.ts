// Tree layout calculation - VERTICAL (top-to-bottom like file explorer)

import { HierarchyNode, FileNode, NodePosition } from "./types";
import * as state from "./state";
import { getNodeId } from "./utils";

// Spacing configuration - ИЛҮҮ ИХ ЗАЙ
const SPACING = {
  horizontal: 350, // Folder хоорондын хэвтээ зай (280 → 350)
  vertical: 280, // Босоо зай (200 → 280)
  nodeWidth: 280, // Node өргөн (240 → 280)
  siblingGap: 100, // Sibling хоорондын зай (60 → 100)
  fileIndent: 250, // File-ийн баруун тийш indent (200 → 250)
  fileVerticalGap: 180, // File хоорондын босоо зай (220 → 180)
};

/**
 * Calculate width needed for a node's subtree (horizontal space)
 */
function calcSubtreeWidth(item: HierarchyNode | FileNode): number {
  if (item.type === "file") {
    return SPACING.nodeWidth;
  }

  const folder = item as HierarchyNode;
  const folderId = getNodeId(folder);
  const isExpanded = folderId ? state.isFolderExpanded(folderId) : false;

  const childFolders = Object.values(folder.children || {});
  const files = folder.files || [];

  const visibleFiles = isExpanded ? files : [];

  if (childFolders.length === 0 && visibleFiles.length === 0) {
    return SPACING.nodeWidth;
  }

  let foldersWidth = 0;
  if (childFolders.length > 0) {
    const folderWidths = childFolders.map((child) => calcSubtreeWidth(child));
    foldersWidth =
      folderWidths.reduce((sum, w) => sum + w, 0) +
      (childFolders.length - 1) * SPACING.siblingGap;
  }

  // Files need extra width when expanded
  const filesWidth =
    visibleFiles.length > 0 ? SPACING.nodeWidth + SPACING.fileIndent + 50 : 0;

  return Math.max(foldersWidth, filesWidth, SPACING.nodeWidth);
}

export function calculateTreeLayout(
  node: HierarchyNode,
  startX = 5000,
  startY = 250,
  level = 0,
): NodePosition[] {
  const positions: NodePosition[] = [];

  const folders = Object.values(node.children || {});
  const files = node.files || [];

  const folderId = getNodeId(node);
  const isExpanded = folderId ? state.isFolderExpanded(folderId) : false;

  // Handle folders - spread HORIZONTALLY
  if (folders.length > 0) {
    const folderWidths = folders.map((f) => calcSubtreeWidth(f));
    const totalWidth =
      folderWidths.reduce((a, b) => a + b, 0) +
      (folders.length - 1) * SPACING.siblingGap;

    let currentX = startX - totalWidth / 2;

    // Folder-ийн Y байрлал - files байвал илүү доош
    const folderY =
      startY +
      SPACING.vertical +
      (isExpanded && files.length > 0
        ? files.length * SPACING.fileVerticalGap
        : 0);

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

      positions.push(
        ...calculateTreeLayout(folder, folderX, folderY, level + 1),
      );

      currentX += folderWidth + SPACING.siblingGap;
    });
  }

  // Handle files - ЗӨВХӨН EXPANDED ҮЕДЭЭ харагдана
  if (isExpanded && files.length > 0) {
    const firstFileY = startY + SPACING.vertical;

    if (files.length === 1) {
      // Single file - баруун тийш indent
      positions.push({
        node: files[0],
        x: startX + SPACING.fileIndent,
        y: firstFileY,
        level: level + 1,
        parentX: startX,
        parentY: startY,
      });
    } else {
      // Multiple files - баруун тийш indent, босоо байрлал
      const fileX = startX + SPACING.fileIndent;

      files.forEach((file, index) => {
        const fileY = firstFileY + index * SPACING.fileVerticalGap;

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
