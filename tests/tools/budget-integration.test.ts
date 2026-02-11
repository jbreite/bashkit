import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createAgentTools } from "@/tools/index";
import { resetOpenRouterCache } from "@/utils/budget-tracking";
import {
  createMockSandbox,
  type MockSandbox,
} from "@test/helpers";
import type { StepResult, ToolSet } from "ai";

/** Mock OpenRouter response with minimal valid pricing data */
const MOCK_OPENROUTER_RESPONSE = {
  data: [
    {
      id: "anthropic/claude-sonnet-4-5",
      pricing: { prompt: "0.000003", completion: "0.000015" },
    },
  ],
};

describe("createAgentTools budget integration", () => {
  let sandbox: MockSandbox;

  beforeEach(() => {
    resetOpenRouterCache();
    sandbox = createMockSandbox({ rgPath: "/usr/bin/rg" });

    // Mock fetch so tests never hit the real OpenRouter API
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => MOCK_OPENROUTER_RESPONSE,
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetOpenRouterCache();
  });

  it("returns budget when maxBudgetUsd is set", async () => {
    const { budget } = await createAgentTools(sandbox, {
      maxBudgetUsd: 5.0,
    });

    expect(budget).toBeDefined();
    expect(budget?.getStatus).toBeInstanceOf(Function);
    expect(budget?.onStepFinish).toBeInstanceOf(Function);
    expect(budget?.stopWhen).toBeInstanceOf(Function);
  });

  it("does not return budget when maxBudgetUsd is not set", async () => {
    const { budget } = await createAgentTools(sandbox);

    expect(budget).toBeUndefined();
  });

  it("budget tracker initial status is correct", async () => {
    const { budget } = await createAgentTools(sandbox, {
      maxBudgetUsd: 10.0,
    });
    if (!budget) throw new Error("expected budget");

    const status = budget.getStatus();
    expect(status.totalCostUsd).toBe(0);
    expect(status.maxBudgetUsd).toBe(10.0);
    expect(status.remainingUsd).toBe(10.0);
    expect(status.usagePercent).toBe(0);
    expect(status.stepsCompleted).toBe(0);
    expect(status.exceeded).toBe(false);
    expect(status.unpricedSteps).toBe(0);
  });

  it("passes modelPricing to budget tracker", async () => {
    const { budget } = await createAgentTools(sandbox, {
      maxBudgetUsd: 5.0,
      modelPricing: {
        "custom-model": { inputPerToken: 0.01, outputPerToken: 0.02 },
      },
    });
    if (!budget) throw new Error("expected budget");

    // Simulate a step with the custom model to verify pricing is used
    const mockStep = {
      response: { modelId: "custom-model", id: "r", timestamp: new Date() },
      usage: {
        inputTokens: 10,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokens: 5,
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
        totalTokens: 15,
      },
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

    budget.onStepFinish(mockStep);

    const status = budget.getStatus();
    // 10 * 0.01 + 5 * 0.02 = 0.1 + 0.1 = 0.2
    expect(status.totalCostUsd).toBeCloseTo(0.2, 6);
    expect(status.stepsCompleted).toBe(1);
  });

  it("still returns all core tools when budget is enabled", async () => {
    const { tools } = await createAgentTools(sandbox, {
      maxBudgetUsd: 5.0,
    });

    expect(tools.Bash).toBeDefined();
    expect(tools.Read).toBeDefined();
    expect(tools.Write).toBeDefined();
    expect(tools.Edit).toBeDefined();
    expect(tools.Glob).toBeDefined();
    expect(tools.Grep).toBeDefined();
  });
});
