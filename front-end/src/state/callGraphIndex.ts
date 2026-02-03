// Update your callGraphIndex state file to include calleeFilePath

export interface CallGraphEdge {
  callerId: string; // Unique ID of the caller function
  callerName: string; // Name of the caller function
  callerFilePath: string; // File path where caller is defined
  calleeId: string; // Unique ID of the callee function
  calleeName: string; // Name of the callee function
  calleeFilePath: string; // File path where callee is defined (for cross-file tracking)
  line: number; // Line number where the call occurs
}

// Example usage in your state/callGraphIndex.ts:

class CallGraphIndex {
  private edges: CallGraphEdge[] = [];

  add(edge: CallGraphEdge): void {
    // Avoid duplicate edges
    const exists = this.edges.some(
      (e) =>
        e.callerId === edge.callerId &&
        e.calleeId === edge.calleeId &&
        e.line === edge.line,
    );

    if (!exists) {
      this.edges.push(edge);
    }
  }

  getAll(): CallGraphEdge[] {
    return this.edges;
  }

  clear(): void {
    this.edges = [];
  }

  // Get all functions that call a specific function
  getCallersOf(functionName: string, filePath: string): CallGraphEdge[] {
    return this.edges.filter(
      (e) => e.calleeName === functionName && e.calleeFilePath === filePath,
    );
  }

  // Get all functions that a specific function calls
  getCalleesOf(functionName: string, filePath: string): CallGraphEdge[] {
    return this.edges.filter(
      (e) => e.callerName === functionName && e.callerFilePath === filePath,
    );
  }

  // Get all edges for a specific file
  getEdgesForFile(filePath: string): CallGraphEdge[] {
    return this.edges.filter(
      (e) => e.callerFilePath === filePath || e.calleeFilePath === filePath,
    );
  }
}

export const callGraphIndex = new CallGraphIndex();
