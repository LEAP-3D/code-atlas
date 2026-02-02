// front-end/src/services/relevantFilesResolver.ts

import { functionIndex } from "../state/functionIndex";
import { fileIndex } from "../state/fileIndex";
import { callGraphIndex } from "../state/callGraphIndex";

interface RelevantFile {
  path: string;
  content: string;
}

class RelevantFilesResolver {
  getRelevantFiles(filePath: string, maxFiles: number = 10): RelevantFile[] {
    const relevantFiles: Map<string, RelevantFile> = new Map();

    // 1. Current file
    const currentFile = fileIndex.get(filePath);
    if (currentFile) {
      relevantFiles.set(filePath, {
        path: this.shortenPath(filePath),
        content: currentFile.text,  // ← text ашиглана
      });
    }

    // 2. Файл дахь функцуудыг олох
    const functionsInFile = functionIndex
      .getAll()
      .filter((fn) => fn.filePath === filePath);

    // 3. Холбогдсон файлууд
    for (const fn of functionsInFile) {
      // Callees
      const callees = callGraphIndex.getCallees(fn.name, filePath);
      for (const callee of callees) {
        if (!relevantFiles.has(callee.filePath)) {
          const file = fileIndex.get(callee.filePath);
          if (file) {
            relevantFiles.set(callee.filePath, {
              path: this.shortenPath(callee.filePath),
              content: file.text,  // ← text
            });
          }
        }
      }

      // Callers
      const callers = callGraphIndex.getCallers(fn.name, filePath);
      for (const caller of callers) {
        if (!relevantFiles.has(caller.filePath)) {
          const file = fileIndex.get(caller.filePath);
          if (file) {
            relevantFiles.set(caller.filePath, {
              path: this.shortenPath(caller.filePath),
              content: file.text,  // ← text
            });
          }
        }
      }
    }

    return Array.from(relevantFiles.values()).slice(0, maxFiles);
  }

  private shortenPath(fullPath: string): string {
    const parts = fullPath.split(/[/\\]/);
    return parts.slice(-3).join("/");
  }
}

export const relevantFilesResolver = new RelevantFilesResolver();