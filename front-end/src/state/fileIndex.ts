import * as vscode from "vscode";

export interface FileRecord {
  uri: vscode.Uri;
  path: string;
  text: string;
}

class FileIndex {
  private files = new Map<string, FileRecord>();

  set(file: FileRecord) {
    this.files.set(file.path, file);
  }

  get(path: string): FileRecord | undefined {
    return this.files.get(path);
  }

  getAll(): FileRecord[] {
    return Array.from(this.files.values());
  }

  clear() {
    this.files.clear();
  }
}

export const fileIndex = new FileIndex();
