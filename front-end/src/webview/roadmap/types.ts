// Roadmap data types
// This file contains all TypeScript interfaces for the roadmap webview

export interface RoadmapFunction {
  name: string;
  filePath: string;
  emoji?: string;
  calls?: string[];
  startLine?: number;
  endLine?: number;
}

export interface RoadmapFile {
  name: string;
  path: string;
  functions: RoadmapFunction[];
  color?: string;
  errorCount?: number;
}

export interface RoadmapDependency {
  importerFilePath: string;
  importedFilePath: string;
  importedNames: string[];
  importPath: string;
}

export interface RoadmapData {
  files: RoadmapFile[];
  dependencies: RoadmapDependency[];
  totalFiles: number;
  totalFunctions: number;
  totalConnections: number;
  diagnosticsSummary?: {
    error: number;
    warning: number;
    info: number;
    hint: number;
    total: number;
  };
  errorBaseline?: {
    date: string;
    baselineErrorCount: number;
    currentErrorCount: number;
    deltaFromBaseline: number;
  };
}

// Hierarchy types
export interface HierarchyNode {
  name: string;
  type: "folder" | "file";
  children: Record<string, HierarchyNode>;
  files: FileNode[];
  level: number;
  path: string;
  parent: HierarchyNode | null;
}

export interface FileNode {
  name: string;
  type: "file";
  fullPath: string;
  functions: RoadmapFunction[];
  parent: HierarchyNode | null;
  level: number;
  path: string;
  errorCount: number;
  color?: string;
}

// Layout types
export interface NodePosition {
  node: HierarchyNode | FileNode;
  x: number;
  y: number;
  level: number;
  parentX?: number;
  parentY?: number;
}

// Rendered node
export interface RenderedNode {
  element: HTMLElement;
  data: HierarchyNode | FileNode;
  x: number;
  y: number;
}

// Connection
export interface Connection {
  line: SVGPathElement;
  childId: string;
  parentId: string | null;
}

// VS Code API type
export interface VSCodeAPI {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    ROADMAP_DATA: RoadmapData;
    acquireVsCodeApi: () => VSCodeAPI;
  }
}
