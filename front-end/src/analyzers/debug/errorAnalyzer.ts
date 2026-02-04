// front-end/src/analyzers/debug/errorAnalyzer.ts

import * as vscode from "vscode";
import * as path from "path";
import { functionIndex } from "../../state/functionIndex";
import { callGraphIndex } from "../../state/callGraphIndex";
import { fileIndex } from "../../state/fileIndex";
import { ImportExportAnalyzer } from "../dependencies/importExportAnalyzer";

export interface ErrorDetail {
  filePath: string;
  fileName: string;
  line: number;
  column: number;
  message: string;
  code: string | number;
  severity: vscode.DiagnosticSeverity;
  functionName: string;
  relatedFunctions: string[];
  relatedFiles: string[];
  errorType: ErrorType;
  suggestion: string;
  // ✅ NEW: Import/Export dependencies
  importDependencies?: string[];
  exportDependencies?: string[];
}

export enum ErrorType {
  SYNTAX = "Syntax Error",
  IMPORT = "Import Error",
  TYPE = "Type Error",
  REFERENCE = "Reference Error",
  UNUSED = "Unused Variable",
  OTHER = "Other Error",
}

export class ErrorAnalyzer {
  /**
   * Analyze all errors in a file and return detailed information
   */
  static analyzeFileErrors(filePath: string): ErrorDetail[] {
    const uri = vscode.Uri.file(filePath);
    const diagnostics = vscode.languages.getDiagnostics(uri);

    const errors: ErrorDetail[] = [];

    // ✅ NEW: Get import/export dependencies for this file
    const fileDeps = ImportExportAnalyzer.analyzeFileDependencies(filePath);
    const importDeps = fileDeps.imports.map((imp) => imp.targetFile);
    const exportDeps = fileDeps.exports.map((exp) => exp.sourceFile);

    console.log(
      `\n📊 [analyzeFileErrors] Dependencies for ${path.basename(filePath)}:`,
    );
    console.log(`   📥 Imports from: ${importDeps.length} files`);
    console.log(`   📤 Imported by: ${exportDeps.length} files`);

    for (const diag of diagnostics) {
      // Skip warnings, only process errors
      if (diag.severity !== vscode.DiagnosticSeverity.Error) {
        continue;
      }

      const line = diag.range.start.line + 1; // Convert to 1-based
      const column = diag.range.start.character + 1;

      // Find the function containing this error
      const func = functionIndex.findByLine(filePath, diag.range.start.line);
      const functionName = func ? func.name : "(global scope)";

      // Analyze error type
      const errorType = this.categorizeError(diag);

      // Find related functions and files
      const relatedFunctions = this.findRelatedFunctions(
        filePath,
        functionName,
        diag.message,
      );

      const relatedFiles = this.findRelatedFiles(filePath, diag.message);

      // Generate suggestion
      const suggestion = this.generateSuggestion(diag, errorType);

      // Handle diagnostic code properly
      let errorCode: string | number = "N/A";
      if (diag.code) {
        if (typeof diag.code === "string" || typeof diag.code === "number") {
          errorCode = diag.code;
        } else if (typeof diag.code === "object" && "value" in diag.code) {
          errorCode = diag.code.value;
        }
      }

      errors.push({
        filePath,
        fileName: filePath.split(/[/\\]/).pop() || filePath,
        line,
        column,
        message: diag.message,
        code: errorCode,
        severity: diag.severity,
        functionName,
        relatedFunctions,
        relatedFiles,
        errorType,
        suggestion,
        // ✅ NEW: Include import/export dependencies
        importDependencies: importDeps,
        exportDependencies: exportDeps,
      });
    }

    return errors;
  }

  /**
   * Categorize error type based on diagnostic message
   */
  private static categorizeError(diag: vscode.Diagnostic): ErrorType {
    const msg = diag.message.toLowerCase();

    if (
      msg.includes("';' expected") ||
      msg.includes("'}' expected") ||
      msg.includes("unexpected token")
    ) {
      return ErrorType.SYNTAX;
    }

    if (
      msg.includes("cannot find module") ||
      (msg.includes("cannot find name") && msg.includes("import"))
    ) {
      return ErrorType.IMPORT;
    }

    if (msg.includes("type ") || msg.includes("not assignable")) {
      return ErrorType.TYPE;
    }

    if (msg.includes("cannot find name") || msg.includes("is not defined")) {
      return ErrorType.REFERENCE;
    }

    if (
      msg.includes("declared but never used") ||
      msg.includes("assigned but never used")
    ) {
      return ErrorType.UNUSED;
    }

    return ErrorType.OTHER;
  }

  /**
   * Find functions related to this error
   */
  private static findRelatedFunctions(
    filePath: string,
    errorFunctionName: string,
    errorMessage: string,
  ): string[] {
    const related: string[] = [];

    // Get the function with the error
    const errorFunc = functionIndex
      .getAll()
      .find((f) => f.filePath === filePath && f.name === errorFunctionName);

    if (!errorFunc) {
      return related;
    }

    // Find callers (functions that call this one)
    const callers = callGraphIndex.getCallersOf(errorFunctionName, filePath);
    callers.forEach((edge) => {
      if (!related.includes(edge.callerName)) {
        related.push(edge.callerName);
      }
    });

    // Find callees (functions this one calls)
    const callees = callGraphIndex.getCalleesOf(errorFunctionName, filePath);
    callees.forEach((edge) => {
      if (!related.includes(edge.calleeName)) {
        related.push(edge.calleeName);
      }
    });

    // Check if error message mentions any function names
    const allFunctions = functionIndex.getAll();
    allFunctions.forEach((func) => {
      if (
        errorMessage.includes(func.name) &&
        !related.includes(func.name) &&
        func.name !== errorFunctionName
      ) {
        related.push(func.name);
      }
    });

    return related;
  }

  /**
   * Find files related to this error
   */
  private static findRelatedFiles(
    filePath: string,
    errorMessage: string,
  ): string[] {
    const related: string[] = [];

    // Check if error message mentions any file names
    const allFiles = fileIndex.getAll();
    allFiles.forEach((file) => {
      const fileName = file.path.split(/[/\\]/).pop() || "";
      const fileNameWithoutExt = fileName.replace(/\.[^.]+$/, "");

      if (
        (errorMessage.includes(fileName) ||
          errorMessage.includes(fileNameWithoutExt)) &&
        file.path !== filePath
      ) {
        related.push(file.path);
      }
    });

    // Get files that are connected through function calls
    const fileFunctions = functionIndex
      .getAll()
      .filter((f) => f.filePath === filePath);

    fileFunctions.forEach((func) => {
      const edges = callGraphIndex.getCalleesOf(func.name, filePath);
      edges.forEach((edge) => {
        if (
          edge.calleeFilePath &&
          edge.calleeFilePath !== filePath &&
          !related.includes(edge.calleeFilePath)
        ) {
          related.push(edge.calleeFilePath);
        }
      });
    });

    return related.slice(0, 5); // Limit to 5 related files
  }

  /**
   * Generate helpful suggestion based on error
   */
  private static generateSuggestion(
    diag: vscode.Diagnostic,
    errorType: ErrorType,
  ): string {
    const msg = diag.message;

    switch (errorType) {
      case ErrorType.SYNTAX:
        if (msg.includes("';' expected")) {
          return "Add a semicolon (;) at the end of the statement.";
        }
        if (msg.includes("'}' expected")) {
          return "Close the block with a closing brace (}).";
        }
        if (msg.includes("unexpected token")) {
          return "Remove or fix the unexpected syntax element.";
        }
        return "Fix the syntax error by checking parentheses, brackets, and braces.";

      case ErrorType.IMPORT:
        if (msg.includes("cannot find module")) {
          return "Check if the module is installed or the import path is correct.";
        }
        return "Verify the import statement and module availability.";

      case ErrorType.TYPE:
        return "Check the TypeScript types and ensure they match.";

      case ErrorType.REFERENCE:
        if (msg.includes("cannot find name")) {
          const match = msg.match(/'([^']+)'/);
          const varName = match ? match[1] : "variable";
          return `Define '${varName}' or import it from the correct module.`;
        }
        return "Ensure the variable or function is defined before use.";

      case ErrorType.UNUSED:
        return "Remove the unused variable or use it in your code.";

      default:
        return "Review the error message for specific guidance.";
    }
  }

  /**
   * ✅ ENHANCED: Build execution flow that shows BOTH function calls AND import/export
   */
  static buildErrorExecutionFlow(error: ErrorDetail): {
    nodes: FlowNode[];
    edges: FlowEdge[];
  } {
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];

    // Add error node (center)
    nodes.push({
      id: `error-${error.functionName}`,
      type: "error",
      label: error.functionName,
      filePath: error.filePath,
      line: error.line,
      description: error.message,
    });

    // ✅ NEW: Add import dependency nodes
    if (error.importDependencies && error.importDependencies.length > 0) {
      error.importDependencies.slice(0, 5).forEach((importPath) => {
        const fileName = path.basename(importPath);
        const nodeId = `import-${fileName}`;

        nodes.push({
          id: nodeId,
          type: "import",
          label: fileName,
          filePath: importPath,
          line: 1,
          description: "Imported by this file",
        });

        edges.push({
          from: `error-${error.functionName}`,
          to: nodeId,
          label: "imports from",
          edgeType: "import",
        });
      });
    }

    // ✅ NEW: Add export dependency nodes (files that import this file)
    if (error.exportDependencies && error.exportDependencies.length > 0) {
      error.exportDependencies.slice(0, 5).forEach((exportPath) => {
        const fileName = path.basename(exportPath);
        const nodeId = `export-${fileName}`;

        nodes.push({
          id: nodeId,
          type: "export",
          label: fileName,
          filePath: exportPath,
          line: 1,
          description: "Imports this file",
        });

        edges.push({
          from: nodeId,
          to: `error-${error.functionName}`,
          label: "imports",
          edgeType: "export",
        });
      });
    }

    // Add related function nodes (function call relationships)
    error.relatedFunctions.slice(0, 5).forEach((funcName) => {
      const func = functionIndex.getAll().find((f) => f.name === funcName);

      if (func) {
        const nodeId = `func-${funcName}`;

        nodes.push({
          id: nodeId,
          type: "function",
          label: funcName,
          filePath: func.filePath,
          line: func.startLine,
          description: `Related function`,
        });

        edges.push({
          from: nodeId,
          to: `error-${error.functionName}`,
          label: "calls",
          edgeType: "function-call",
        });
      }
    });

    // Add related file nodes
    error.relatedFiles.slice(0, 3).forEach((filePath) => {
      const fileName = path.basename(filePath);
      const nodeId = `file-${fileName}`;

      nodes.push({
        id: nodeId,
        type: "file",
        label: fileName,
        filePath: filePath,
        line: 1,
        description: "Related file",
      });

      edges.push({
        from: nodeId,
        to: `error-${error.functionName}`,
        label: "related",
        edgeType: "file-relation",
      });
    });

    console.log(`\n🔨 [buildErrorExecutionFlow] Built flow:`);
    console.log(`   Nodes: ${nodes.length}`);
    console.log(`   - Import deps: ${error.importDependencies?.length || 0}`);
    console.log(`   - Export deps: ${error.exportDependencies?.length || 0}`);
    console.log(`   - Function calls: ${error.relatedFunctions.length}`);
    console.log(`   - Related files: ${error.relatedFiles.length}`);
    console.log(`   Edges: ${edges.length}`);

    return { nodes, edges };
  }
}

export interface FlowNode {
  id: string;
  type: "error" | "function" | "file" | "import" | "export";
  label: string;
  filePath: string;
  line: number;
  description: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  label: string;
  edgeType: "import" | "export" | "function-call" | "file-relation";
}
