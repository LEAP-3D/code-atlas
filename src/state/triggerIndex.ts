import * as path from "path";

export interface TriggerInfo {
  functionName: string;
  filePath: string;
  trigger: string;
}

class TriggerIndex {
  private triggers: TriggerInfo[] = [];

  clear() {
    this.triggers = [];
  }

  add(info: TriggerInfo) {
    this.triggers.push({
      ...info,
      filePath: path.normalize(info.filePath),
    });
  }

  find(functionName: string, filePath: string): TriggerInfo | undefined {
    const normalized = path.normalize(filePath);

    return this.triggers.find(
      (t) => t.functionName === functionName && t.filePath === normalized
    );
  }
}

export const triggerIndex = new TriggerIndex();
