export interface CallEdge {
  callerId: string;
  callerName: string;
  calleeId?: string; // ← ЭНИЙГ НЭМ
  calleeName: string;
  filePath: string;
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
      (e) => e.calleeName === calleeName && e.filePath === filePath
    );
  }
}

export const callGraphIndex = new CallGraphIndex();
