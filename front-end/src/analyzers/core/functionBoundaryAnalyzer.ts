import * as ts from "typescript";
import { functionIndex } from "../../state/functionIndex";

export function analyzeFunctionBoundaries(
  files: { path: string; text: string }[]
) {
  functionIndex.clear();

  console.log("🔍 [analyzeFunctionBoundaries] Starting analysis...");

  for (const file of files) {
    console.log(`📄 [analyzeFunctionBoundaries] Analyzing: ${file.path}`);

    const sourceFile = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      true
    );

    const functionStack: string[] = [];

    function registerFunction(name: string, node: ts.Node) {
      // Skip empty or invalid names
      if (!name || name.trim() === "") {
        console.warn(`⚠️ Skipping function with empty name at ${file.path}`);
        return;
      }

      const parentFunction =
        functionStack.length > 0
          ? functionStack[functionStack.length - 1]
          : undefined;

      const startLine =
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

      const endLine =
        sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

      const functionRecord = {
        id: `${file.path}:${name}:${startLine}`,
        name,
        filePath: file.path,
        startLine,
        endLine,
        parentFunction,
      };

      console.log(
        `✅ Registered: ${name} (${startLine}-${endLine})${
          parentFunction ? ` parent: ${parentFunction}` : ""
        }`
      );

      functionIndex.add(functionRecord);

      // Push to stack and traverse children
      functionStack.push(name);
      ts.forEachChild(node, visit);
      functionStack.pop();
    }

    function visit(node: ts.Node) {
      // 1. function Home() {} - Named function declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        registerFunction(node.name.text, node);
        return;
      }

      // 2. const handleSubmit = async () => {} - Arrow function assignments
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) ||
          ts.isFunctionExpression(node.initializer)) &&
        ts.isIdentifier(node.name)
      ) {
        registerFunction(node.name.text, node.initializer);
        return;
      }

      // 3. Class method declarations
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        registerFunction(node.name.text, node);
        return;
      }

      // 4. Object literal methods: { handleClick() {} }
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) ||
          ts.isFunctionExpression(node.initializer))
      ) {
        registerFunction(node.name.text, node.initializer);
        return;
      }

      // 5. Shorthand method declarations in object literals
      if (ts.isShorthandPropertyAssignment(node)) {
        // Skip shorthand properties - they're not function definitions
        ts.forEachChild(node, visit);
        return;
      }

      // 6. Export default function
      if (ts.isExportAssignment(node) && node.expression) {
        if (
          ts.isFunctionExpression(node.expression) ||
          ts.isArrowFunction(node.expression)
        ) {
          // Only register if it has a name, otherwise use "default"
          const name = node.expression.name?.getText() || "default";
          registerFunction(name, node.expression);
          return;
        }
      }

      // Continue traversing
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  const total = functionIndex.getAll().length;
  console.log(
    `✅ [analyzeFunctionBoundaries] Completed. Found ${total} functions.`
  );
}
