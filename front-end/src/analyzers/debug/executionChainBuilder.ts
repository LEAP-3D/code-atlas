import { callGraphIndex } from "../../state/callGraphIndex";

export function buildCallerChain(
  targetFunctionName: string,
  filePath: string,
  depth = 0,
  maxDepth = 6
): string[] {
  if (depth >= maxDepth) return [];

  const callers = callGraphIndex.getCallersOf(targetFunctionName, filePath);

  if (callers.length === 0) {
    return [targetFunctionName];
  }

  const chain: string[] = [];

  for (const c of callers) {
    const parentChain = buildCallerChain(
      c.callerName,
      filePath,
      depth + 1,
      maxDepth
    );
    chain.push(...parentChain, targetFunctionName);
  }

  return Array.from(new Set(chain));
}
