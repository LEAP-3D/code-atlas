// Hierarchy building functions

import { RoadmapFile, HierarchyNode, FileNode } from "./types";

/**
 * Find common base path from all files
 */
export function findBasePath(files: RoadmapFile[]): string {
  if (files.length === 0) return "";

  const paths = files.map((f) => f.path.replace(/\\/g, "/"));
  const splitPaths = paths.map((p) => p.split("/").filter((part) => part));
  const firstParts = splitPaths[0];

  let commonLength = firstParts.length;
  splitPaths.slice(1).forEach((parts) => {
    let i = 0;
    const max = Math.min(commonLength, parts.length);
    while (i < max && parts[i] === firstParts[i]) {
      i++;
    }
    commonLength = i;
  });

  if (commonLength === 0) return "";

  const commonParts = firstParts.slice(0, commonLength);
  const firstIsAbsoluteUnix = paths[0].startsWith("/");
  const firstLooksLikeWindowsDrive = /^[A-Za-z]:$/.test(commonParts[0] || "");

  if (firstLooksLikeWindowsDrive) {
    return commonParts.join("/");
  }

  return `${firstIsAbsoluteUnix ? "/" : ""}${commonParts.join("/")}`;
}

/**
 * Build hierarchy tree from flat file list
 */
export function buildHierarchy(files: RoadmapFile[]): HierarchyNode {
  const basePath = findBasePath(files);
  const pathParts = basePath ? basePath.split("/").filter((p) => p) : [];
  const projectName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : "Project";

  const root: HierarchyNode = {
    name: projectName,
    type: "folder",
    children: {},
    files: [],
    level: 0,
    path: projectName,
    parent: null,
  };

  files.forEach((file) => {
    let relativePath = file.path.replace(/\\/g, "/");

    // Remove base path
    if (basePath) {
      const baseWithSlash = basePath.endsWith("/") ? basePath : basePath + "/";
      if (relativePath.startsWith(baseWithSlash)) {
        relativePath = relativePath.substring(baseWithSlash.length);
      } else if (relativePath.startsWith(basePath)) {
        relativePath = relativePath.substring(basePath.length);
        if (relativePath.startsWith("/")) {
          relativePath = relativePath.substring(1);
        }
      }
    }

    const parts = relativePath.split("/").filter((p) => p);
    if (parts.length === 0) return;

    let current = root;
    let currentLevel = 0;

    // Navigate/create folder structure
    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      if (!current.children[folderName]) {
        current.children[folderName] = {
          name: folderName,
          type: "folder",
          children: {},
          files: [],
          parent: current,
          level: currentLevel + 1,
          path: parts.slice(0, i + 1).join("/"),
        };
      }
      current = current.children[folderName];
      currentLevel++;
    }

    // Add file to current folder
    const fileName = parts[parts.length - 1];
    current.files.push({
      name: fileName,
      type: "file",
      fullPath: file.path,
      functions: file.functions || [],
      parent: current,
      level: currentLevel + 1,
      path: relativePath,
      errorCount: file.errorCount || 0,
      color: file.color,
    });
  });

  // Flatten if only one child folder at root
  const childFolders = Object.keys(root.children);
  if (childFolders.length === 1 && root.files.length === 0) {
    const onlyChild = root.children[childFolders[0]];
    onlyChild.parent = null;
    onlyChild.level = 0;
    return onlyChild;
  }

  return root;
}

/**
 * Find a file node by its full path
 */
export function findFileNodeByPath(
  hierarchyData: HierarchyNode,
  filePath: string
): FileNode | null {
  function search(node: HierarchyNode): FileNode | null {
    // Check files in this folder
    if (node.files) {
      for (const f of node.files) {
        if (f.fullPath === filePath) return f;
      }
    }
    
    // Check child folders
    if (node.children) {
      for (const c of Object.values(node.children)) {
        const found = search(c);
        if (found) return found;
      }
    }
    
    return null;
  }
  
  return search(hierarchyData);
}
