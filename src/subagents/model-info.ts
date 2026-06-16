import type { LanguageModel } from "ai";
import type { SubagentModelInfo } from "./types";

export function createSubagentModelInfo(
  model: LanguageModel | undefined,
): SubagentModelInfo {
  if (typeof model === "object" && model !== null && "modelId" in model) {
    const modelId = (model as { modelId?: unknown }).modelId;
    if (typeof modelId === "string") return { id: modelId };
  }

  return {
    id: null,
  };
}
