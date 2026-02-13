// Utility functions

import { HierarchyNode, FileNode } from "./types";

/**
 * Get node ID for tracking
 */
export function getNodeId(
  node: HierarchyNode | FileNode | null,
): string | null {
  if (!node) return null;
  return node.type === "folder"
    ? `folder-${(node as HierarchyNode).path || node.name}`
    : `file-${(node as FileNode).path}`;
}

/**
 * Get function icon based on function name
 */
export function getFunctionIcon(name: string): string {
  const l = name.toLowerCase();
  if (l.startsWith("use")) return "🪝";
  if (l.startsWith("handle")) return "🎯";
  if (l.includes("fetch") || l.includes("api")) return "📡";
  if (l.includes("render")) return "🎨";
  if (l.includes("analyze") || l.includes("build")) return "⚙️";
  return "⚡";
}

/**
 * Get DOM element by ID (typed)
 */
export function getElement<T extends Element>(id: string): T {
  const el = document.getElementById(id);

  if (!el) {
    throw new Error(`Element with id "${id}" not found`);
  }

  return el as unknown as T;
}

/**
 * Check if node is a file node
 */
export function isFileNode(node: HierarchyNode | FileNode): node is FileNode {
  return node.type === "file" && "fullPath" in node;
}

/**
 * Check if node is a folder node
 */
export function isFolderNode(
  node: HierarchyNode | FileNode,
): node is HierarchyNode {
  return node.type === "folder";
}
