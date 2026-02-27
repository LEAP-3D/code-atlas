export type RoadmapCommandName =
  | "saveState"
  | "goToFunction"
  | "openFile"
  | "goToLine"
  | "debugExecutionFlow"
  | "copyFile"
  | "copyAllFiles"
  | "copyAIContext"
  | "copySmartAIContext"
  | "getErrorDetails"
  | "refreshRoadmapData"
  | "showAllErrors"
  | "pickMonorepoRoadmapProject"
  | "roadmapWebviewReady";

export type RoadmapCommandMessage = {
  command: RoadmapCommandName;
  filePath?: string;
  line?: number;
  files?: string[];
  errorFile?: string;
  context?: string;
  includeRelatedFiles?: boolean;
  requestId?: string;
  includeWarnings?: boolean;
  state?: {
    scale: number;
    translateX: number;
    translateY: number;
    focusedFilePath?: string;
  };
};

export type RoadmapDiagnosticsSeverity = "error" | "warning" | "info" | "hint";

export type RoadmapDiagnosticItem = {
  line: number;
  message: string;
  severity: RoadmapDiagnosticsSeverity;
  code?: string;
  source?: string;
};

export type RoadmapWebviewMessage =
  | {
      type: "restoreState";
      state: {
        scale: number;
        translateX: number;
        translateY: number;
        focusedFilePath?: string;
      };
    }
  | { type: "roadmapDataUpdated"; data: unknown; updatedAt?: number }
  | { type: "roadmapDataRefreshFailed"; error?: string; updatedAt?: number }
  | {
      type: "roadmapEmptyState";
      title?: string;
      message?: string;
      actionLabel?: string;
      actionCommand?: string;
    }
  | {
      type: "errorDetails";
      filePath: string;
      requestId: string;
      issues: RoadmapDiagnosticItem[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isRoadmapCommandMessage(
  value: unknown,
): value is RoadmapCommandMessage {
  if (!isRecord(value) || typeof value.command !== "string") {
    return false;
  }

  const command = value.command as RoadmapCommandName;
  const knownCommands: RoadmapCommandName[] = [
    "saveState",
    "goToFunction",
    "openFile",
    "goToLine",
    "debugExecutionFlow",
    "copyFile",
    "copyAllFiles",
    "copyAIContext",
    "copySmartAIContext",
    "getErrorDetails",
    "refreshRoadmapData",
    "showAllErrors",
    "pickMonorepoRoadmapProject",
    "roadmapWebviewReady",
  ];

  if (!knownCommands.includes(command)) {
    return false;
  }

  if ("filePath" in value && value.filePath !== undefined) {
    if (typeof value.filePath !== "string") return false;
  }
  if ("line" in value && value.line !== undefined) {
    if (typeof value.line !== "number") return false;
  }
  if ("requestId" in value && value.requestId !== undefined) {
    if (typeof value.requestId !== "string") return false;
  }
  if ("files" in value && value.files !== undefined) {
    if (!Array.isArray(value.files)) return false;
  }
  if ("includeRelatedFiles" in value && value.includeRelatedFiles !== undefined) {
    if (typeof value.includeRelatedFiles !== "boolean") return false;
  }

  return true;
}

export function isRoadmapWebviewMessage(
  value: unknown,
): value is RoadmapWebviewMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "restoreState":
      return isRecord(value.state);
    case "roadmapDataUpdated":
      return "data" in value;
    case "roadmapDataRefreshFailed":
      return true;
    case "roadmapEmptyState":
      return true;
    case "errorDetails":
      return (
        typeof value.filePath === "string" &&
        typeof value.requestId === "string" &&
        Array.isArray(value.issues)
      );
    default:
      return false;
  }
}
