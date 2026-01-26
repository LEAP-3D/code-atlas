import * as vscode from "vscode";
import { functionIndex } from "../../state/functionIndex";

export interface MappedError {
  filePath: string;
  message: string;
  line: number;
  functionName: string;
}

export function mapErrorsToFunctions(
  document: vscode.TextDocument
): MappedError[] {
  const diagnostics = vscode.languages.getDiagnostics(document.uri);
  const results: MappedError[] = [];

  for (const diag of diagnostics) {
    // ⛔ lint / unused warning-уудыг алгасна
    if (
      diag.code === 6133 || // declared but never used
      diag.code === 6196 // assigned but never used
    ) {
      continue;
    }

    const line = diag.range.start.line;
    const fn = functionIndex.findByLine(document.uri.fsPath, line);

    results.push({
      filePath: document.uri.fsPath,
      message: diag.message,
      line,
      functionName: fn ? fn.name : "(outside function)",
    });
  }

  return results;
}
