import ts from "typescript";
import * as path from "path";
import { FileRecord } from "../../state/fileIndex";
import { dependencyIndex } from "../../state/dependencyIndex";

/**
 * Analyzer to track import dependencies between files
 * Finds which files import from which other files
 */
export function analyzeImportDependencies(files: FileRecord[]) {
  console.log("🔍 [analyzeImportDependencies] Starting analysis...");
  
  dependencyIndex.clear();

  for (const file of files) {
    console.log(`📄 [analyzeImportDependencies] Analyzing: ${file.path}`);

    const sourceFile = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      true
    );

    // Visit all nodes in the file
    function visit(node: ts.Node) {
      // Check if this is an import declaration
      if (ts.isImportDeclaration(node)) {
        analyzeImport(node, file.path, files);
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  const totalDeps = dependencyIndex.getAll().length;
  console.log(`✅ [analyzeImportDependencies] Complete: ${totalDeps} dependencies found`);
}

/**
 * Analyze a single import statement
 */
function analyzeImport(
  node: ts.ImportDeclaration,
  currentFilePath: string,
  allFiles: FileRecord[]
) {
  // Get the import path: import X from "HERE"
  const moduleSpecifier = node.moduleSpecifier;
  
  if (!ts.isStringLiteral(moduleSpecifier)) {
    return; // Skip if not a string literal
  }

  const importPath = moduleSpecifier.text;
  
  console.log(`   📥 Import found: "${importPath}"`);

  // Get imported names: import { X, Y } from "..."
  const importedNames = extractImportedNames(node);
  
  console.log(`      Names: [${importedNames.join(", ")}]`);

  // Resolve the import path to an actual file path
  const resolvedPath = resolveImportPath(importPath, currentFilePath, allFiles);

  if (!resolvedPath) {
    console.log(`      ⚠️  Could not resolve import path`);
    return;
  }

  console.log(`      ✅ Resolved to: ${resolvedPath}`);

  // Add to dependency index
  dependencyIndex.add({
    importerFilePath: currentFilePath,
    importedFilePath: resolvedPath,
    importedNames: importedNames,
    importPath: importPath,
  });
}

/**
 * Extract the names being imported from an import statement
 */
function extractImportedNames(node: ts.ImportDeclaration): string[] {
  const names: string[] = [];

  const importClause = node.importClause;
  if (!importClause) {
    return names;
  }

  // Default import: import X from "..."
  if (importClause.name) {
    names.push(importClause.name.text);
  }

  // Named imports: import { X, Y } from "..."
  if (importClause.namedBindings) {
    if (ts.isNamedImports(importClause.namedBindings)) {
      importClause.namedBindings.elements.forEach((element) => {
        names.push(element.name.text);
      });
    }
    
    // Namespace import: import * as X from "..."
    if (ts.isNamespaceImport(importClause.namedBindings)) {
      names.push(importClause.namedBindings.name.text);
    }
  }

  return names;
}

/**
 * Resolve an import path to an actual file path
 * Handles:
 * - Relative imports: "./MovieCard", "../utils/helper"
 * - Alias imports: "@/app/components/MovieCard"
 * - Package imports: "react", "next/image" (ignored)
 */
function resolveImportPath(
  importPath: string,
  currentFilePath: string,
  allFiles: FileRecord[]
): string | null {
  // Ignore node_modules imports
  if (!importPath.startsWith(".") && !importPath.startsWith("@/")) {
    return null;
  }

  // Handle alias imports (@/...)
  if (importPath.startsWith("@/")) {
    // Find the workspace root (usually where 'src' or 'app' is)
    const workspaceRoot = findWorkspaceRoot(currentFilePath);
    
    // Remove @/ and resolve from workspace root
    const relativePath = importPath.substring(2); // Remove "@/"
    const resolvedPath = path.join(workspaceRoot, relativePath);

    return findMatchingFile(resolvedPath, allFiles);
  }

  // Handle relative imports (./... or ../...)
  if (importPath.startsWith(".")) {
    const currentDir = path.dirname(currentFilePath);
    const resolvedPath = path.resolve(currentDir, importPath);

    return findMatchingFile(resolvedPath, allFiles);
  }

  return null;
}

/**
 * Find the workspace root directory
 */
function findWorkspaceRoot(filePath: string): string {
  const parts = filePath.split(path.sep);
  
  // Look for common root directories
  const rootMarkers = ["src", "app"];
  
  for (let i = parts.length - 1; i >= 0; i--) {
    if (rootMarkers.includes(parts[i])) {
      return parts.slice(0, i).join(path.sep);
    }
  }

  // Fallback: return directory containing the file
  return path.dirname(filePath);
}

/**
 * Find a file matching the resolved path
 * Tries different extensions (.ts, .tsx, .js, .jsx)
 */
function findMatchingFile(
  resolvedPath: string,
  allFiles: FileRecord[]
): string | null {
  // Try exact match first
  const exactMatch = allFiles.find((f) => f.path === resolvedPath);
  if (exactMatch) {
    return exactMatch.path;
  }

  // Try with different extensions
  const extensions = [".ts", ".tsx", ".js", ".jsx"];
  
  for (const ext of extensions) {
    const pathWithExt = resolvedPath + ext;
    const match = allFiles.find((f) => f.path === pathWithExt);
    
    if (match) {
      return match.path;
    }
  }

  // Try as index file
  for (const ext of extensions) {
    const indexPath = path.join(resolvedPath, `index${ext}`);
    const match = allFiles.find((f) => f.path === indexPath);
    
    if (match) {
      return match.path;
    }
  }

  return null;
}