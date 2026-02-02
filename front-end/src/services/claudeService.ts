// front-end/src/services/claudeService.ts

import Anthropic from "@anthropic-ai/sdk";
import * as vscode from "vscode";

export class ClaudeService {
  private client: Anthropic | null = null;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async initialize(): Promise<boolean> {
    let apiKey = await this.context.secrets.get("claudeApiKey");

    if (!apiKey) {
      apiKey = await vscode.window.showInputBox({
        prompt: "Claude API Key оруулна уу",
        password: true,
        placeHolder: "sk-ant-api03-...",
        ignoreFocusOut: true,
      });

      if (apiKey) {
        await this.context.secrets.store("claudeApiKey", apiKey);
        vscode.window.showInformationMessage("✓ API Key хадгалагдлаа");
      }
    }

    if (!apiKey) {
      return false;
    }

    this.client = new Anthropic({ apiKey });
    return true;
  }

  async askWithContext(
    relevantFiles: Array<{ path: string; content: string }>,
    question: string
  ): Promise<string> {
    if (!this.client) {
      throw new Error("Claude not initialized");
    }

    const contextStr = relevantFiles
      .map((f) => `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``)
      .join("\n\n");

    const message = `## Project Context (Relevant Files Only)

${contextStr}

## Question
${question}`;

    const response = await this.client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: message }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock ? textBlock.text : "No response";
  }

  async clearApiKey(): Promise<void> {
    await this.context.secrets.delete("claudeApiKey");
    this.client = null;
  }

  isInitialized(): boolean {
    return this.client !== null;
  }
}