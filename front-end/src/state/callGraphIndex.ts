// front-end/src/state/callGraphIndex.ts

export interface CallEdge {
  callerId: string;
  callerName: string;
  callerFilePath: string; // required
  calleeId?: string;
  calleeName: string;
  calleeFilePath?: string; // optional
  line: number;
}

class CallGraphIndex {
  private edges: CallEdge[] = [];

  clear() {
    this.edges = [];
  }

  add(edge: CallEdge) {
    this.edges.push(edge);
  }

  getAll(): CallEdge[] {
    return this.edges;
  }

  getCallersOf(calleeName: string, filePath: string): CallEdge[] {
    return this.edges.filter(
      (e) => e.calleeName === calleeName && e.callerFilePath === filePath,
    );
  }

  getCallers(
    functionName: string,
    _filePath: string,
  ): Array<{ name: string; filePath: string }> {
    const callers = this.edges
      .filter((e) => e.calleeName === functionName)
      .map((e) => ({
        name: e.callerName,
        filePath: e.callerFilePath,
      }));

    const unique = new Map<string, { name: string; filePath: string }>();
    callers.forEach((c) => unique.set(`${c.name}:${c.filePath}`, c));

    return Array.from(unique.values());
  }

  getCallees(
    functionName: string,
    filePath: string,
  ): Array<{ name: string; filePath: string }> {
    const callees = this.edges
      .filter(
        (e) => e.callerName === functionName && e.callerFilePath === filePath,
      )
      .map((e) => ({
        name: e.calleeName,
        filePath: e.calleeFilePath || e.callerFilePath,
      }));

    const unique = new Map<string, { name: string; filePath: string }>();
    callees.forEach((c) => unique.set(`${c.name}:${c.filePath}`, c));

    return Array.from(unique.values());
  }

  getEdgesForFile(filePath: string): CallEdge[] {
    return this.edges.filter(
      (e) => e.callerFilePath === filePath || e.calleeFilePath === filePath,
    );
  }
}

export const callGraphIndex = new CallGraphIndex();
