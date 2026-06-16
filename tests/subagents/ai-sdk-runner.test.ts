import { describe, expect, it } from "vitest";
import type { LanguageModel, ModelMessage, StepResult, ToolSet } from "ai";
import {
  createAiSdkSubagentRunner,
  createSubagentProfileRegistry,
  type AiSdkSubagentGenerateOptions,
  type AiSdkSubagentGenerateResult,
  type ResolvedSubagentRunRequest,
  type SubagentEvent,
  type SubagentUsage,
} from "@/subagents";

function model(): LanguageModel {
  return { modelId: "test-model" } as LanguageModel;
}

function usage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokenDetails: {
      noCacheTokens: inputTokens,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: {
      textTokens: outputTokens,
      reasoningTokens: undefined,
    },
  };
}

function fakeStep(): StepResult<ToolSet> {
  return {
    toolCalls: [
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "Read",
        input: { path: "src/index.ts" },
      },
    ],
    toolResults: [
      {
        type: "tool-result",
        toolCallId: "call_1",
        toolName: "Read",
        input: { path: "src/index.ts" },
        output: { content: "ok" },
      },
    ],
    usage: usage(10, 5),
  } as unknown as StepResult<ToolSet>;
}

function request(
  overrides?: Partial<ResolvedSubagentRunRequest>,
): ResolvedSubagentRunRequest {
  const registry = createSubagentProfileRegistry({
    defaults: { model: model(), context: { recent_turns: 1 } },
  });
  const profile = registry.resolve(undefined);
  if ("error" in profile) throw new Error(profile.error);

  return {
    handle: { agent_id: "agent_1", task_name: "research" },
    task: "child task",
    profile,
    parent_id: null,
    depth: 0,
    tools: {},
    messages: [
      { role: "user", content: "old" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "recent" },
    ],
    callbacks: {
      onStatus: async () => undefined,
      onEvent: async () => undefined,
      onUsage: async () => undefined,
    },
    ...overrides,
  };
}

describe("createAiSdkSubagentRunner", () => {
  it("runs generateText with inherited messages and reports usage/events", async () => {
    const seen: {
      options?: AiSdkSubagentGenerateOptions;
      events: SubagentEvent[];
      usage: SubagentUsage[];
    } = { events: [], usage: [] };
    const runner = createAiSdkSubagentRunner({
      generateText: async (options): Promise<AiSdkSubagentGenerateResult> => {
        seen.options = options;
        await options.onStepFinish?.(fakeStep());
        return {
          text: "done",
          usage: usage(1, 2),
          totalUsage: usage(11, 7),
          steps: [fakeStep()],
          response: {
            messages: [{ role: "assistant", content: "full transcript" }],
          },
        };
      },
    });

    const result = await runner.run(
      request({
        callbacks: {
          onStatus: async () => undefined,
          onEvent: async (event) => {
            seen.events.push({ ...event, timestamp: "now" });
          },
          onUsage: async (value) => {
            seen.usage.push(value);
          },
        },
      }),
    );

    expect(result).toMatchObject({
      status: "completed",
      result: "done",
      usage: { inputTokens: 11, outputTokens: 7 },
      transcript_ref: "subagent-transcript:agent_1",
      result_ref: "subagent-result:agent_1",
      metadata: { message_count: 1, step_count: 1 },
    });
    expect(seen.options?.messages).toEqual([
      { role: "user", content: "recent" },
      { role: "user", content: "child task" },
    ]);
    expect(typeof seen.options?.stopWhen).toBe("function");
    expect(seen.usage).toContainEqual({ inputTokens: 10, outputTokens: 5 });
    expect(seen.usage).toContainEqual({ inputTokens: 11, outputTokens: 7 });
    expect(seen.events.map((event) => event.type)).toEqual([
      "subagent.tool_call",
      "subagent.tool_result",
    ]);
  });

  it("returns failed when no model is available", async () => {
    const registry = createSubagentProfileRegistry();
    const profile = registry.resolve(undefined);
    if ("error" in profile) throw new Error(profile.error);
    const runner = createAiSdkSubagentRunner();

    const result = await runner.run(request({ profile }));

    expect(result).toEqual({
      agent_id: "agent_1",
      task_name: "research",
      status: "failed",
      error: "Subagent profile does not define a model",
    });
  });

  it("returns interrupted for aborted generation", async () => {
    const runner = createAiSdkSubagentRunner({
      generateText: async (options): Promise<AiSdkSubagentGenerateResult> => {
        options.abortSignal?.dispatchEvent(new Event("abort"));
        throw new DOMException("aborted", "AbortError");
      },
    });

    const result = await runner.run(request());

    expect(result).toMatchObject({
      status: "interrupted",
      error: "Subagent interrupted",
    });
  });
});
