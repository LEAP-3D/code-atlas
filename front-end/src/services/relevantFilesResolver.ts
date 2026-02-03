import { functionIndex } from "../state/functionIndex";
import { callGraphIndex } from "../state/callGraphIndex";

export interface RelevantFile {
  path: string;
  reason: string;
}

class RelevantFilesResolver {
  /**
   * Find files relevant to a given file based on the call graph
   * @param filePath The file to find related files for
   * @returns Array of relevant files with reasons
   */
  getRelevantFiles(filePath: string): RelevantFile[] {
    const relevantFiles = new Map<string, string>();

    // Always include the current file
    relevantFiles.set(filePath, "Current file");

    // Get all functions in the current file
    const currentFileFunctions = functionIndex
      .getAll()
      .filter((fn) => fn.filePath === filePath);

    // For each function in the current file
    for (const fn of currentFileFunctions) {
      // Find functions that THIS function calls (callees)
      const callees = callGraphIndex.getCalleesOf(fn.name, filePath); // ✅ FIXED: getCallees → getCalleesOf

      for (const edge of callees) {
        const calleeFilePath = edge.calleeFilePath || edge.callerFilePath;
        if (calleeFilePath && calleeFilePath !== filePath) {
          relevantFiles.set(
            calleeFilePath,
            `Called by ${fn.name} → ${edge.calleeName}`,
          );
        }
      }

      // Find functions that call THIS function (callers)
      const callers = callGraphIndex.getCallersOf(fn.name, filePath); // ✅ FIXED: getCallers → getCallersOf

      for (const edge of callers) {
        const callerFilePath = edge.callerFilePath;
        if (callerFilePath && callerFilePath !== filePath) {
          relevantFiles.set(
            callerFilePath,
            `Calls ${fn.name} from ${edge.callerName}`,
          );
        }
      }
    }

    // Convert map to array
    return Array.from(relevantFiles.entries()).map(([path, reason]) => ({
      path,
      reason,
    }));
  }

  /**
   * Get files that directly call functions in the given file
   * @param filePath The file to check
   * @returns Array of files that call functions in this file
   */
  getCallerFiles(filePath: string): string[] {
    const callerFiles = new Set<string>();

    const currentFileFunctions = functionIndex
      .getAll()
      .filter((fn) => fn.filePath === filePath);

    for (const fn of currentFileFunctions) {
      const callers = callGraphIndex.getCallersOf(fn.name, filePath); // ✅ FIXED

      for (const edge of callers) {
        if (edge.callerFilePath && edge.callerFilePath !== filePath) {
          callerFiles.add(edge.callerFilePath);
        }
      }
    }

    return Array.from(callerFiles);
  }

  /**
   * Get files that are called by functions in the given file
   * @param filePath The file to check
   * @returns Array of files called by this file
   */
  getCalleeFiles(filePath: string): string[] {
    const calleeFiles = new Set<string>();

    const currentFileFunctions = functionIndex
      .getAll()
      .filter((fn) => fn.filePath === filePath);

    for (const fn of currentFileFunctions) {
      const callees = callGraphIndex.getCalleesOf(fn.name, filePath); // ✅ FIXED

      for (const edge of callees) {
        const calleeFilePath = edge.calleeFilePath || edge.callerFilePath;
        if (calleeFilePath && calleeFilePath !== filePath) {
          calleeFiles.add(calleeFilePath);
        }
      }
    }

    return Array.from(calleeFiles);
  }
}

export const relevantFilesResolver = new RelevantFilesResolver();
