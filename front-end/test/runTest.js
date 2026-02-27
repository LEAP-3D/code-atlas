/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(__dirname, "suite", "index.js");

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
    });
  } catch (error) {
    console.error("Integration test run failed:", error);
    process.exit(1);
  }
}

main();

