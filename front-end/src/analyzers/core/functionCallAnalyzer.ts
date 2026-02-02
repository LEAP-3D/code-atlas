import ts from "typescript";
import { functionIndex } from "../../state/functionIndex";
import { callGraphIndex } from "../../state/callGraphIndex";
import { FileRecord } from "../../state/fileIndex";

export function analyzeFunctionCalls(files: FileRecord[]) {
  callGraphIndex.clear();

  console.log("🔍 analyzeFunctionCalls: START");
  console.log(
    "📂 Files:",
    files.map((f) => f.path),
  );

  for (const file of files) {
    console.log("\n📄 Analyzing file:", file.path);

    const sourceFile = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      true,
    );

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(),
        );

        console.log(
          `📞 Found CallExpression at ${file.path}:${line + 1}:${character + 1}`,
        );

        const caller = functionIndex.findByLine(file.path, line);

        if (!caller) {
          console.log("⚠️  No caller function found for this line");
          ts.forEachChild(node, visit);
          return;
        }

        let calleeName = "unknown";

        if (ts.isIdentifier(node.expression)) {
          calleeName = node.expression.text;
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          calleeName = node.expression.name.text;
        }

        console.log(`➡️  Caller: ${caller.name} | Callee name: ${calleeName}`);

        const callee = functionIndex
          .getAll()
          .find((fn) => fn.name === calleeName && fn.filePath === file.path);

        if (!callee) {
          console.log(`🚫 Callee NOT FOUND in functionIndex: ${calleeName}`);
          ts.forEachChild(node, visit);
          return;
        }

        const edge = {
          callerId: caller.id,
          callerName: caller.name,
          callerFilePath: file.path, // filePath → callerFilePath
          calleeId: callee.id,
          calleeName,
          line: line + 1,
        };

        console.log("✅ EDGE CREATED:", edge);

        callGraphIndex.add(edge);
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  console.log("\n📊 FINAL callGraphIndex:", callGraphIndex.getAll());
  console.log("🔍 analyzeFunctionCalls: END");
}
