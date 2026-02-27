// Roadmap data models

export interface RoadmapFunction {
  name: string;
  filePath: string;
  emoji: string;
  calls: string[]; // Function names this function calls
  startLine: number;
  endLine: number;
}

export interface RoadmapFile {
  name: string; // File name (e.g., "Home.tsx")
  path: string; // Full file path
  functions: RoadmapFunction[];
  color?: string; // File color (red if has errors, blue otherwise)
  errorCount?: number; // Number of errors in this file
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
