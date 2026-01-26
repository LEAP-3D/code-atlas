import { functionIndex } from "../state/functionIndex";
import { callGraphIndex } from "../state/callGraphIndex";
import { fileIndex } from "../state/fileIndex";

export function buildRoadmapMermaid(): string {
  let mermaid = "graph TD\n";
  const added = new Set<string>();
  const files = fileIndex.getAll();

  // Group functions by file
  const fileGroups = new Map<string, any[]>();

  for (const fn of functionIndex.getAll()) {
    if (!fileGroups.has(fn.filePath)) {
      fileGroups.set(fn.filePath, []);
    }
    fileGroups.get(fn.filePath)!.push(fn);
  }

  // Create file nodes and function nodes
  for (const file of files) {
    const fileName = file.path.split("/").pop() || file.path;
    const fileId = `file_${sanitizeId(file.path)}`;

    if (!added.has(fileId)) {
      mermaid += `  ${fileId}["📁 ${fileName}"]\n`;
      mermaid += `  style ${fileId} fill:#2d3748,stroke:#4a5568,stroke-width:2px\n`;
      added.add(fileId);
    }

    const funcs = fileGroups.get(file.path) || [];

    for (const fn of funcs) {
      const fnId = sanitizeId(fn.id);

      if (!added.has(fnId)) {
        // Add function node with emoji based on type
        const emoji = getFunctionEmoji(fn.name);
        mermaid += `  ${fnId}["${emoji} ${fn.name}"]\n`;

        // Color code by function type
        const color = getFunctionColor(fn.name);
        mermaid += `  style ${fnId} fill:${color}\n`;

        added.add(fnId);
      }

      // Connect file to function
      mermaid += `  ${fileId} -.-> ${fnId}\n`;
    }
  }

  // Add call relationships between functions
  const edges = callGraphIndex.getAll();
  const processedEdges = new Set<string>();

  for (const edge of edges) {
    if (!edge.calleeId) continue;

    const fromId = sanitizeId(edge.callerId);
    const toId = sanitizeId(edge.calleeId);
    const edgeKey = `${fromId}->${toId}`;

    // Avoid duplicate edges
    if (processedEdges.has(edgeKey)) continue;
    processedEdges.add(edgeKey);

    if (added.has(fromId) && added.has(toId)) {
      mermaid += `  ${fromId} --> ${toId}\n`;
    }
  }

  return mermaid;
}

function sanitizeId(id: string): string {
  // Remove invalid characters and ensure unique IDs
  return id
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "");
}

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

function getFunctionColor(name: string): string {
  const lower = name.toLowerCase();

  // Event handlers - blue
  if (
    lower.startsWith("handle") ||
    lower.includes("click") ||
    lower.includes("submit")
  ) {
    return "#3182ce";
  }
  // Hooks - purple
  if (lower.startsWith("use")) {
    return "#805ad5";
  }
  // Data operations - green
  if (
    lower.includes("fetch") ||
    lower.includes("get") ||
    lower.includes("save")
  ) {
    return "#38a169";
  }
  // Analyzers/processors - orange
  if (lower.includes("analyze") || lower.includes("build")) {
    return "#dd6b20";
  }

  // Default - gray
  return "#4a5568";
}
