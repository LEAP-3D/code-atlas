import * as path from "path";

/**
 * Represents a single import dependency
 */
export interface DependencyRecord {
  importerFilePath: string;   // File that imports
  importedFilePath: string;   // File being imported
  importedNames: string[];    // Names being imported (e.g., ["MovieCard", "Header"])
  importPath: string;         // Original import string (e.g., "@/components/MovieCard")
}

/**
 * Index of all import dependencies in the project
 */
class DependencyIndex {
  private dependencies: DependencyRecord[] = [];

  /**
   * Clear all dependencies
   */
  clear(): void {
    this.dependencies = [];
  }

  /**
   * Add a new dependency
   */
  add(dependency: DependencyRecord): void {
    // Normalize paths
    const normalized: DependencyRecord = {
      ...dependency,
      importerFilePath: path.normalize(dependency.importerFilePath),
      importedFilePath: path.normalize(dependency.importedFilePath),
    };

    this.dependencies.push(normalized);
  }

  /**
   * Get all dependencies
   */
  getAll(): DependencyRecord[] {
    return this.dependencies;
  }

  /**
   * Get all files that a given file imports FROM
   * Example: MovieList.js imports FROM [MovieCard.js, Header.js]
   */
  getImportsOf(filePath: string): DependencyRecord[] {
    const normalized = path.normalize(filePath);
    return this.dependencies.filter(
      (dep) => dep.importerFilePath === normalized
    );
  }

  /**
   * Get all files that import a given file
   * Example: MovieCard.js is imported BY [MovieList.js, SearchResults.js]
   */
  getImportersOf(filePath: string): DependencyRecord[] {
    const normalized = path.normalize(filePath);
    return this.dependencies.filter(
      (dep) => dep.importedFilePath === normalized
    );
  }

  /**
   * Get all related files (both imports and importers)
   * This is what we'll use for highlighting!
   */
  getRelatedFiles(filePath: string): {
    imports: DependencyRecord[];    // Files this file imports FROM
    importedBy: DependencyRecord[]; // Files that import this file
  } {
    return {
      imports: this.getImportsOf(filePath),
      importedBy: this.getImportersOf(filePath),
    };
  }

  /**
   * Check if two files have any dependency relationship
   */
  areRelated(filePathA: string, filePathB: string): boolean {
    const normalizedA = path.normalize(filePathA);
    const normalizedB = path.normalize(filePathB);

    return this.dependencies.some(
      (dep) =>
        (dep.importerFilePath === normalizedA && dep.importedFilePath === normalizedB) ||
        (dep.importerFilePath === normalizedB && dep.importedFilePath === normalizedA)
    );
  }
}

export const dependencyIndex = new DependencyIndex();