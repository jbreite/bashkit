/**
 * Shared mock factory for StepResult used in budget tracking tests.
 */
import type { LanguageModelUsage, StepResult, ToolSet } from "ai";

export function makeUsage(
  overrides: Partial<LanguageModelUsage> = {},
): LanguageModelUsage {
  return {
    inputTokens: 0,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens: 0,
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
    totalTokens: 0,
    ...overrides,
  };
}

export function makeStep(
  modelId: string,
  usage: Partial<LanguageModelUsage> = {},
): StepResult<ToolSet> {
  return {
    response: { modelId, id: "resp-1", timestamp: new Date(), headers: {} },
    usage: makeUsage(usage),
    content: [],
    text: "",
    reasoning: [],
    reasoningText: undefined,
    files: [],
    sources: [],
    toolCalls: [],
    staticToolCalls: [],
    dynamicToolCalls: [],
    toolResults: [],
    staticToolResults: [],
    dynamicToolResults: [],
    finishReason: "stop",
    rawFinishReason: "stop",
    warnings: undefined,
    request: { headers: {} },
    providerMetadata: undefined,
    isContinued: false,
  } as unknown as StepResult<ToolSet>;
}
