export interface RoadmapFunction {
  name: string;
  filePath: string;
  calls: string[];
  emoji?: string;
  startLine?: number;
  endLine?: number;
}

export interface RoadmapFile {
  path: string;
  name: string;
  functions: RoadmapFunction[];
}

export interface RoadmapData {
  files: RoadmapFile[];
  totalFiles: number;
  totalFunctions: number;
  totalConnections: number;
}
