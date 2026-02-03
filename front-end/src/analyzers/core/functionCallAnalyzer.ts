import ts from "typescript";
import { functionIndex } from "../../state/functionIndex";
import { callGraphIndex } from "../../state/callGraphIndex";
import { FileRecord } from "../../state/fileIndex";

export function analyzeFunctionCalls(files: FileRecord[]) {
  callGraphIndex.clear();

  console.log("🔍 [analyzeFunctionCalls] START");
  console.log(`📂 Analyzing ${files.length} files for function calls...`);

  for (const file of files) {
    console.log(`\n📄 [analyzeFunctionCalls] File: ${file.path}`);

    const sourceFile = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      true,
    );

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(),
        );

        // Find the caller function (function that contains this call)
        const caller = functionIndex.findByLine(file.path, line);

        if (!caller) {
          console.log(`⚠️  [${line + 1}] Call outside any function - skipping`);
          ts.forEachChild(node, visit);
          return;
        }

        // Extract callee name
        let calleeName = "unknown";

        if (ts.isIdentifier(node.expression)) {
          // Direct function call: doSomething()
          calleeName = node.expression.text;
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          // Method call: obj.method() or Class.staticMethod()
          calleeName = node.expression.name.text;
        }

        if (calleeName === "unknown") {
          ts.forEachChild(node, visit);
          return;
        }

        console.log(`📞 [${line + 1}] ${caller.name} → ${calleeName}`);

        // Try to find callee in the SAME file first
        let callee = functionIndex
          .getAll()
          .find((fn) => fn.name === calleeName && fn.filePath === file.path);

        // If not found in same file, search across ALL files
        if (!callee) {
          callee = functionIndex.getAll().find((fn) => fn.name === calleeName);
        }

        if (!callee) {
          console.log(
            `   🔍 Callee "${calleeName}" not found in any indexed file - might be external or built-in`,
          );
          ts.forEachChild(node, visit);
          return;
        }

        // Create edge
        const edge = {
          callerId: caller.id,
          callerName: caller.name,
          callerFilePath: caller.filePath,
          calleeId: callee.id,
          calleeName: callee.name,
          calleeFilePath: callee.filePath, // Add this for cross-file tracking
          line: line + 1,
        };

        console.log(
          `   ✅ Edge: ${caller.name} (${caller.filePath}) → ${callee.name} (${callee.filePath})`,
        );

        callGraphIndex.add(edge);
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  const totalEdges = callGraphIndex.getAll().length;
  console.log(
    `\n✅ [analyzeFunctionCalls] COMPLETE: ${totalEdges} function calls detected`,
  );

  // Debug: Show sample edges
  const sampleEdges = callGraphIndex.getAll().slice(0, 5);
  if (sampleEdges.length > 0) {
    console.log("\n📊 Sample edges:");
    sampleEdges.forEach((edge) => {
      console.log(`   ${edge.callerName} → ${edge.calleeName}`);
    });
  }
}
