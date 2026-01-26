import * as vscode from "vscode";
import { fileIndex } from "../../state/fileIndex";
import { ScannedFile } from "./workspaceScanner";

export async function loadWorkspaceFileContents(files: ScannedFile[]) {
  fileIndex.clear();

  for (const file of files) {
    const document = await vscode.workspace.openTextDocument(file.uri);

    fileIndex.set({
      uri: file.uri,
      path: file.path,
      text: document.getText(),
    });
  }
}
