// front-end/src/analyzers/dependencies/importExportAnalyzer.ts

import * as path from "path";
import { fileIndex } from "../../state/fileIndex";

export interface ImportExportRelation {
  sourceFile: string;
  targetFile: string;
  relationType: "import" | "export" | "re-export";
  importedItems: string[];
  line: number;
  statement: string;
}

export interface FileDependendencyGraph {
  file: string;
  imports: ImportExportRelation[];
  exports: ImportExportRelation[];
  totalDependencies: number;
}

export class ImportExportAnalyzer {
  /**
   * Analyze import/export dependencies for a single file
   */
  static analyzeFileDependencies(filePath: string): FileDependendencyGraph {
    console.log(
      `\n🔍 [ImportExportAnalyzer] Analyzing: ${path.basename(filePath)}`,
    );

    const imports = this.findImports(filePath);
    const exports = this.findExports(filePath);

    console.log(`   📥 Imports: ${imports.length}`);
    console.log(`   📤 Exports: ${exports.length}`);

    return {
      file: filePath,
      imports,
      exports,
      totalDependencies: imports.length + exports.length,
    };
  }

  /**
   * Find all imports in a file
   */
  private static findImports(filePath: string): ImportExportRelation[] {
    const relations: ImportExportRelation[] = [];

    try {
      const fileContent = fileIndex.getAll().find((f) => f.path === filePath);
      if (!fileContent) return relations;

      const lines = fileContent.text.split("\n");
      const fileDir = path.dirname(filePath);

      lines.forEach((line, index) => {
        const trimmed = line.trim();

        // Match: import ... from '...'
        const importMatch = trimmed.match(
          /^import\s+(.+?)\s+from\s+['"](.+?)['"]/,
        );

        if (importMatch) {
          const importedItems = this.extractImportedItems(importMatch[1]);
          const importPath = importMatch[2];
          const resolvedPath = this.resolveImportPath(importPath, fileDir);

          if (resolvedPath) {
            relations.push({
              sourceFile: filePath,
              targetFile: resolvedPath,
              relationType: "import",
              importedItems,
              line: index + 1,
              statement: trimmed,
            });
          }
        }

        // Match: export ... from '...' (re-export)
        const reExportMatch = trimmed.match(
          /^export\s+(.+?)\s+from\s+['"](.+?)['"]/,
        );

        if (reExportMatch) {
          const exportedItems = this.extractImportedItems(reExportMatch[1]);
          const importPath = reExportMatch[2];
          const resolvedPath = this.resolveImportPath(importPath, fileDir);

          if (resolvedPath) {
            relations.push({
              sourceFile: filePath,
              targetFile: resolvedPath,
              relationType: "re-export",
              importedItems: exportedItems,
              line: index + 1,
              statement: trimmed,
            });
          }
        }
      });
    } catch (error) {
      console.error(`   ❌ Error analyzing imports:`, error);
    }

    return relations;
  }

  /**
   * Find all files that import this file
   */
  private static findExports(filePath: string): ImportExportRelation[] {
    const relations: ImportExportRelation[] = [];

    try {
      const allFiles = fileIndex.getAll();

      allFiles.forEach((file) => {
        if (file.path === filePath) return;

        const lines = file.text.split("\n");
        const otherFileDir = path.dirname(file.path);

        lines.forEach((line, index) => {
          const trimmed = line.trim();
          const importMatch = trimmed.match(
            /^import\s+(.+?)\s+from\s+['"](.+?)['"]/,
          );

          if (importMatch) {
            const importPath = importMatch[2];
            const resolvedPath = this.resolveImportPath(
              importPath,
              otherFileDir,
            );

            if (resolvedPath === filePath) {
              const importedItems = this.extractImportedItems(importMatch[1]);

              relations.push({
                sourceFile: file.path,
                targetFile: filePath,
                relationType: "export",
                importedItems,
                line: index + 1,
                statement: trimmed,
              });
            }
          }
        });
      });
    } catch (error) {
      console.error(`   ❌ Error finding exports:`, error);
    }

    return relations;
  }

  private static extractImportedItems(importClause: string): string[] {
    const items: string[] = [];
    let clause = importClause.trim();

    if (clause.includes("* as ")) {
      return [clause];
    }

    const bracketMatch = clause.match(/\{(.+?)\}/);
    if (bracketMatch) {
      const insideBrackets = bracketMatch[1];
      insideBrackets.split(",").forEach((item) => {
        const cleaned = item.trim().split(" as ")[0].trim();
        if (cleaned) items.push(cleaned);
      });
      clause = clause.replace(/\{.+?\}/, "").trim();
    }

    if (clause && clause !== ",") {
      const defaultExport = clause.replace(/,/g, "").trim();
      if (defaultExport) {
        items.unshift(defaultExport);
      }
    }

    return items.length > 0 ? items : ["(unknown)"];
  }

  private static resolveImportPath(
    importPath: string,
    fromDir: string,
  ): string | null {
    if (!importPath.startsWith(".")) {
      return null; // External package
    }

    let resolved = path.resolve(fromDir, importPath);
    const extensions = [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      "/index.ts",
      "/index.tsx",
    ];
    const allFiles = fileIndex.getAll().map((f) => f.path);

    for (const ext of extensions) {
      const candidate = resolved + ext;
      if (allFiles.includes(candidate)) {
        return candidate;
      }
    }

    if (allFiles.includes(resolved)) {
      return resolved;
    }

    return null;
  }
}
