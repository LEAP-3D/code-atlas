import ts from "typescript";
import { triggerIndex } from "../../state/triggerIndex";
import { FileRecord } from "../../state/fileIndex";

const EVENT_PROPS = ["onClick", "onSubmit", "onChange", "onBlur", "onFocus"];

export function analyzeRuntimeTriggers(files: FileRecord[]) {
  triggerIndex.clear();

  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      true
    );

    function visit(node: ts.Node) {
      if (ts.isJsxAttribute(node)) {
        const propName = node.name.getText(); // ✅ ЗАСВАР

        if (!EVENT_PROPS.includes(propName)) {
          return;
        }

        const initializer = node.initializer;

        if (
          initializer &&
          ts.isJsxExpression(initializer) &&
          initializer.expression &&
          ts.isIdentifier(initializer.expression)
        ) {
          const fnName = initializer.expression.text;

          triggerIndex.add({
            functionName: fnName,
            filePath: file.path, // ← normalize дотор хийгдэнэ
            trigger: `User interaction (${propName})`,
          });
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }
}
