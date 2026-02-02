// front-end/src/services/aiService.ts

import * as vscode from "vscode";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import OpenAI from "openai";

export type AIProvider = "claude" | "gemini" | "groq" | "openrouter";

interface ProviderConfig {
  name: string;
  description: string;
  keyPlaceholder: string;
  keyUrl: string;
  free: boolean;
}

export const PROVIDERS: Record<AIProvider, ProviderConfig> = {
  claude: {
    name: "Claude (Anthropic)",
    description: "Хамгийн ухаалаг, төлбөртэй",
    keyPlaceholder: "sk-ant-api03-...",
    keyUrl: "https://console.anthropic.com/",
    free: false,
  },
  gemini: {
    name: "Google Gemini",
    description: "Үнэгүй, сайн чанар",
    keyPlaceholder: "AIza...",
    keyUrl: "https://aistudio.google.com/apikey",
    free: true,
  },
  groq: {
    name: "Groq",
    description: "Үнэгүй, маш хурдан",
    keyPlaceholder: "gsk_...",
    keyUrl: "https://console.groq.com/keys",
    free: true,
  },
  openrouter: {
    name: "OpenRouter",
    description: "Олон model, зарим үнэгүй",
    keyPlaceholder: "sk-or-...",
    keyUrl: "https://openrouter.ai/keys",
    free: true,
  },
};

export class AIService {
  private context: vscode.ExtensionContext;
  private currentProvider: AIProvider = "gemini";

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadProvider();
  }

  private async loadProvider() {
    const saved = await this.context.globalState.get<AIProvider>("aiProvider");
    if (saved) {
      this.currentProvider = saved;
    }
  }

  async setProvider(provider: AIProvider) {
    this.currentProvider = provider;
    await this.context.globalState.update("aiProvider", provider);
  }

  getProvider(): AIProvider {
    return this.currentProvider;
  }

  getProviderConfig(): ProviderConfig {
    return PROVIDERS[this.currentProvider];
  }

  async getApiKey(): Promise<string | undefined> {
    return await this.context.secrets.get(`apiKey_${this.currentProvider}`);
  }

  async setApiKey(key: string) {
    await this.context.secrets.store(`apiKey_${this.currentProvider}`, key);
  }

  async clearApiKey() {
    await this.context.secrets.delete(`apiKey_${this.currentProvider}`);
  }

  async hasApiKey(): Promise<boolean> {
    const key = await this.getApiKey();
    return !!key;
  }

  async askWithContext(
    relevantFiles: Array<{ path: string; content: string }>,
    question: string,
  ): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error("API key тохируулаагүй байна");
    }

    const contextStr = relevantFiles
      .map((f) => `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``)
      .join("\n\n");

    const prompt = `## Project Context\n\n${contextStr}\n\n## Question\n${question}`;

    switch (this.currentProvider) {
      case "claude":
        return this.askClaude(apiKey, prompt);
      case "gemini":
        return this.askGemini(apiKey, prompt);
      case "groq":
        return this.askGroq(apiKey, prompt);
      case "openrouter":
        return this.askOpenRouter(apiKey, prompt);
      default:
        throw new Error("Unknown provider");
    }
  }

  private async askClaude(apiKey: string, prompt: string): Promise<string> {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock ? textBlock.text : "No response";
  }

  private async askGemini(apiKey: string, prompt: string): Promise<string> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // ← засав
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  private async askGroq(apiKey: string, prompt: string): Promise<string> {
    const client = new Groq({ apiKey });
    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile", // ← засав
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
    });
    return response.choices[0]?.message?.content || "No response";
  }

  private async askOpenRouter(apiKey: string, prompt: string): Promise<string> {
    const client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
    const response = await client.chat.completions.create({
      model: "meta-llama/llama-3.1-8b-instruct:free",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
    });
    return response.choices[0]?.message?.content || "No response";
  }
}
