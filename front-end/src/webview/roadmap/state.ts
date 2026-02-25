// Global state management

import {
  RoadmapData,
  HierarchyNode,
  RenderedNode,
  Connection,
  FileNode,
  VSCodeAPI,
} from "./types";

// VS Code API
export let vscode: VSCodeAPI;

// Data
export let roadmapData: RoadmapData = {
  files: [],
  dependencies: [],
  totalFiles: 0,
  totalFunctions: 0,
  totalConnections: 0,
};
export let hierarchyData: HierarchyNode | null = null;

// Rendered elements
export let allNodes: RenderedNode[] = [];
export let connections: Connection[] = [];

// View state
export let focusedFile: FileNode | null = null;
export let scale = 0.5;
export let translateX = 0;
export let translateY = 0;
export let isDragging = false;
export let startX = 0;
export let startY = 0;
export let searchQuery = "";
export const matchedNodeIds = new Set<string>();
export const searchExpandedFolders = new Set<string>();

// Expanded folders - эхлээд хоосон (files нуугдсан)
export const expandedFolders = new Set<string>();

// Constants
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 3;
export const ZOOM_STEP = 0.15;

// Setters
export function setVscode(api: VSCodeAPI): void {
  vscode = api;
}

export function setRoadmapData(data: RoadmapData): void {
  roadmapData = data;
}

export function setHierarchyData(data: HierarchyNode | null): void {
  hierarchyData = data;
}

export function setAllNodes(nodes: RenderedNode[]): void {
  allNodes = nodes;
}

export function addNode(node: RenderedNode): void {
  allNodes.push(node);
}

export function setConnections(conns: Connection[]): void {
  connections = conns;
}

export function addConnection(conn: Connection): void {
  connections.push(conn);
}

export function setFocusedFile(file: FileNode | null): void {
  focusedFile = file;
}

export function setScale(s: number): void {
  scale = s;
}

export function setTranslate(x: number, y: number): void {
  translateX = x;
  translateY = y;
}

export function setDragging(d: boolean): void {
  isDragging = d;
}

export function setDragStart(x: number, y: number): void {
  startX = x;
  startY = y;
}

export function setSearchQuery(query: string): void {
  searchQuery = query.trim().toLowerCase();
}

export function hasActiveSearch(): boolean {
  return searchQuery.length > 0;
}

export function clearSearchMatches(): void {
  matchedNodeIds.clear();
  searchExpandedFolders.clear();
}

export function setSearchMatch(nodeId: string): void {
  matchedNodeIds.add(nodeId);
}

export function setSearchExpandedFolder(folderId: string): void {
  searchExpandedFolders.add(folderId);
}

export function isSearchMatch(nodeId: string): boolean {
  return matchedNodeIds.has(nodeId);
}

// Clear state
export function clearRenderState(): void {
  allNodes = [];
  connections = [];
}

// Toggle folder expanded state
export function toggleFolderExpanded(folderId: string): void {
  if (expandedFolders.has(folderId)) {
    expandedFolders.delete(folderId);
  } else {
    expandedFolders.add(folderId);
  }
}

// Check if folder is expanded (files visible)
export function isFolderExpanded(folderId: string): boolean {
  return expandedFolders.has(folderId) || searchExpandedFolders.has(folderId);
}

// Collapse all folders (default initial view)
export function clearExpandedFolders(): void {
  expandedFolders.clear();
}
