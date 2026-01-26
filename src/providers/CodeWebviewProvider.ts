import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { fileIndex } from "../state/fileIndex";
import { functionIndex, FunctionRecord } from "../state/functionIndex";
import { callGraphIndex } from "../state/callGraphIndex";
import {
  RoadmapData,
  RoadmapFile,
  RoadmapFunction,
} from "../roadmap/roadmapModel";

export class CodeWebviewProvider {
  static show(
    context: vscode.ExtensionContext,
    data: {
      summary: string;
      errorText: string;
      relevantCode: string;
      selectedCode: string;
      mermaidDiagram: string;
    }
  ) {
    const panel = vscode.window.createWebviewPanel(
      "codeExplanation",
      "Filtered Prompt Preview",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    panel.webview.html = this.getHtml(panel.webview, context, data);
  }

  static showRoadmap(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
      "roadmapView",
      "📊 Project Roadmap",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    panel.webview.html = this.getRoadmapHtml(panel.webview, context);
  }

  private static getRoadmapHtml(
    webview: vscode.Webview,
    context: vscode.ExtensionContext
  ): string {
    const htmlPath = path.join(
      context.extensionPath,
      "src",
      "webview",
      "roadmap.html"
    );

    let html = fs.readFileSync(htmlPath, "utf8");

    // Build roadmap data structure
    const roadmapData = this.buildRoadmapData();

    console.log("📊 [getRoadmapHtml] Injecting data into HTML");
    console.log(`  Total files: ${roadmapData.totalFiles}`);
    console.log(`  Total functions: ${roadmapData.totalFunctions}`);

    // Inject data as a proper JSON script tag
    const dataScript = `<script>window.ROADMAP_DATA = ${JSON.stringify(
      roadmapData
    )};</script>`;

    // Insert script before closing </head> tag
    html = html.replace("</head>", `${dataScript}\n</head>`);

    return html;
  }

  private static buildRoadmapData(): RoadmapData {
    console.log("🔨 [buildRoadmapData] Starting to build roadmap data...");

    const files = fileIndex.getAll();
    const allFunctions = functionIndex.getAll();
    const allEdges = callGraphIndex.getAll();

    console.log(`  📁 Total files indexed: ${files.length}`);
    console.log(`  ⚡ Total functions indexed: ${allFunctions.length}`);
    console.log(`  🔗 Total call edges: ${allEdges.length}`);

    const roadmapFiles: RoadmapFile[] = [];

    for (const file of files) {
      const fileName = file.path.split(/[/\\]/).pop() || file.path;

      // Get functions for this specific file
      const fileFunctions = allFunctions.filter(
        (fn) => fn.filePath === file.path
      );

      console.log(`  📄 ${fileName}: ${fileFunctions.length} functions`);

      if (fileFunctions.length === 0) {
        console.log(`    ⚠️  Skipping ${fileName} - no functions found`);
        continue;
      }

      const functions: RoadmapFunction[] = fileFunctions.map((fn) => {
        // Get outgoing calls from this function
        const calls = allEdges
          .filter((edge) => edge.callerId === fn.id)
          .map((edge) => edge.calleeName);

        if (calls.length > 0) {
          console.log(`    ⚡ ${fn.name}: calls [${calls.join(", ")}]`);
        }

        return {
          name: fn.name,
          filePath: fn.filePath,
          emoji: this.getFunctionEmoji(fn.name),
          calls: calls,
          startLine: fn.startLine,
          endLine: fn.endLine,
        };
      });

      roadmapFiles.push({
        name: fileName,
        path: file.path,
        functions: functions,
      });
    }

    const result: RoadmapData = {
      files: roadmapFiles,
      totalFiles: roadmapFiles.length,
      totalFunctions: roadmapFiles.reduce(
        (sum, f) => sum + f.functions.length,
        0
      ),
      totalConnections: allEdges.length,
    };

    console.log("✅ [buildRoadmapData] Roadmap data built successfully:");
    console.log(`  📁 Files with functions: ${result.totalFiles}`);
    console.log(`  ⚡ Total functions: ${result.totalFunctions}`);
    console.log(`  🔗 Total connections: ${result.totalConnections}`);

    // Debug: Show first few files
    roadmapFiles.slice(0, 3).forEach((file) => {
      console.log(
        `  Sample: ${file.name} - ${file.functions
          .map((f) => f.name)
          .join(", ")}`
      );
    });

    return result;
  }

  private static getFunctionEmoji(name: string): string {
    const lower = name.toLowerCase();

    if (
      lower.startsWith("handle") ||
      lower.includes("click") ||
      lower.includes("submit")
    ) {
      return "🎯";
    }
    if (lower.startsWith("use") || lower.includes("hook")) {
      return "🪝";
    }
    if (
      lower.includes("fetch") ||
      lower.includes("get") ||
      lower.includes("load")
    ) {
      return "📥";
    }
    if (
      lower.includes("save") ||
      lower.includes("update") ||
      lower.includes("post")
    ) {
      return "💾";
    }
    if (lower.includes("render") || lower.includes("component")) {
      return "🎨";
    }
    if (
      lower.includes("analyze") ||
      lower.includes("build") ||
      lower.includes("process")
    ) {
      return "⚙️";
    }

    return "⚡";
  }

  private static getFunctionColor(name: string): string {
    const lower = name.toLowerCase();

    if (
      lower.startsWith("handle") ||
      lower.includes("click") ||
      lower.includes("submit")
    ) {
      return "#3182ce";
    }
    if (lower.startsWith("use")) {
      return "#805ad5";
    }
    if (
      lower.includes("fetch") ||
      lower.includes("get") ||
      lower.includes("save")
    ) {
      return "#38a169";
    }
    if (lower.includes("analyze") || lower.includes("build")) {
      return "#dd6b20";
    }

    return "#4a5568";
  }

  private static getHtml(
    webview: vscode.Webview,
    context: vscode.ExtensionContext,
    data: {
      summary: string;
      errorText: string;
      relevantCode: string;
      selectedCode: string;
      mermaidDiagram: string;
    }
  ): string {
    const htmlPath = path.join(
      context.extensionPath,
      "src",
      "webview",
      "index.html"
    );

    let html = fs.readFileSync(htmlPath, "utf8");

    html = html
      .replace("{{SUMMARY}}", this.escape(data.summary))
      .replace("{{ERROR}}", this.escape(data.errorText))
      .replace("{{RELEVANT}}", this.escape(data.relevantCode))
      .replace("{{SELECTED}}", this.escape(data.selectedCode))
      .replace("{{MERMAID}}", this.escape(data.mermaidDiagram));

    return html;
  }

  private static escape(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
