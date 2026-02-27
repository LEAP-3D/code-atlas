/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("assert");
const vscode = require("vscode");

async function assertCommandExists(commandId) {
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes(commandId), `Missing command: ${commandId}`);
}

async function runSmokeTests() {
  await assertCommandExists("experiment.showRoadmap");
  await assertCommandExists("experiment.showSelectedCode");
  await assertCommandExists("experiment.askAI");

  await vscode.commands.executeCommand("experiment.showRoadmap");
  await vscode.commands.executeCommand("experiment.showSelectedCode");
}

module.exports.run = async function run() {
  await runSmokeTests();
};

