export interface FunctionRecord {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  parentFunction?: string;
}

class FunctionIndex {
  private functions: FunctionRecord[] = [];

  clear() {
    this.functions = [];
  }

  add(fn: FunctionRecord) {
    this.functions.push(fn);
  }

  getAll(): FunctionRecord[] {
    return this.functions;
  }

  findByLine(filePath: string, line: number) {
    const matches = this.functions.filter(
      (fn) =>
        fn.filePath === filePath && line >= fn.startLine && line <= fn.endLine
    );

    return matches.sort((a, b) => b.startLine - a.startLine)[0];
  }
}

export const functionIndex = new FunctionIndex();
