import { buildCallerChain } from "./executionChainBuilder";
import { triggerIndex } from "../../state/triggerIndex";
import { functionIndex } from "../../state/functionIndex";

export function buildExecutionMermaid(
  filePath: string,
  errorFunctions: string[]
): string {
  let mermaid = "graph TD\n";
  const added = new Set<string>();

  for (const fnName of errorFunctions) {
    let chain = buildCallerChain(fnName, filePath);

    // 🔧 FALLBACK: function нь дотроо зарлагдсан бол parent-ийг нэмнэ
    if (chain.length === 1) {
      const fn = functionIndex
        .getAll()
        .find((f) => f.name === fnName && f.filePath === filePath);

      if (fn && fn.parentFunction) {
        chain = [fn.parentFunction, fnName];
      }
    }

    for (let i = 0; i < chain.length; i++) {
      const current = chain[i];
      const next = chain[i + 1];

      if (!added.has(current)) {
        const trigger = triggerIndex.find(current, filePath);

        const label = trigger ? `${current} ❌ (${trigger.trigger})` : current;

        mermaid += `  ${current}["${label}"]\n`;
        added.add(current);
      }

      if (next) {
        mermaid += `  ${current} --> ${next}\n`;
      }
    }
  }

  return mermaid;
}
