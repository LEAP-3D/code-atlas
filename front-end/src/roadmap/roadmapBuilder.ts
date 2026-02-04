import { fileIndex } from "../state/fileIndex";
import { functionIndex } from "../state/functionIndex";
import { callGraphIndex } from "../state/callGraphIndex";
import { RoadmapFile } from "./roadmapModel";

export function buildRoadmap(): RoadmapFile[] {
  return fileIndex.getAll().map((file) => {
    const fileName = file.path.split(/[/\\]/).pop() || file.path;

    // Get functions for this file
    const fileFunctions = functionIndex
      .getAll()
      .filter((fn) => fn.filePath === file.path);

    const functions = fileFunctions.map((fn) => {
      // Get outgoing calls from this function
      const calls = callGraphIndex
        .getAll()
        .filter((edge) => edge.callerId === fn.id)
        .map((edge) => edge.calleeName);

      return {
        name: fn.name,
        filePath: fn.filePath,
        emoji: getFunctionEmoji(fn.name), // ⬅️ НЭМСЭН
        calls: calls,
        startLine: fn.startLine, // ⬅️ НЭМСЭН
        endLine: fn.endLine, // ⬅️ НЭМСЭН
      };
    });

    return {
      path: file.path,
      name: fileName,
      functions: functions,
    };
  });
}

// ⬅️ ШИНЭ ФУНКЦ: emoji сонгох
function getFunctionEmoji(name: string): string {
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
