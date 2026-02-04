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

// ✅ ШИНЭ: Dependency interface
export interface RoadmapDependency {
  importerFilePath: string;   // File that imports
  importedFilePath: string;   // File being imported
  importedNames: string[];    // Names imported (e.g., ["MovieCard", "Header"])
  importPath: string;         // Original import string (e.g., "@/components/MovieCard")
}

export interface RoadmapData {
  files: RoadmapFile[];
  dependencies: RoadmapDependency[]; // ✅ ШИНЭ
  totalFiles: number;
  totalFunctions: number;
  totalConnections: number;
}