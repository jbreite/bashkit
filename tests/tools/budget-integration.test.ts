import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createAgentTools } from "@/tools/index";
import { createTaskTool } from "@/tools/task";
import {
  createBudgetTracker,
  resetOpenRouterCache,
} from "@/utils/budget-tracking";
import { createMockSandbox, makeStep, type MockSandbox } from "@test/helpers";
import { MockLanguageModelV3 } from "ai/test";

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

  it("returns budget when budget config is set", async () => {
    const { budget } = await createAgentTools(sandbox, {
      budget: { maxUsd: 5.0, pricingProvider: "openRouter" },
    });

    expect(budget).toBeDefined();
    expect(budget?.getStatus).toBeInstanceOf(Function);
    expect(budget?.onStepFinish).toBeInstanceOf(Function);
    expect(budget?.stopWhen).toBeInstanceOf(Function);
  });

  it("does not return budget when budget config is not set", async () => {
    const { budget } = await createAgentTools(sandbox);

    expect(budget).toBeUndefined();
  });

  it("budget tracker initial status is correct", async () => {
    const { budget } = await createAgentTools(sandbox, {
      budget: { maxUsd: 10.0, pricingProvider: "openRouter" },
    });
    if (!budget) throw new Error("expected budget");

    const status = budget.getStatus();
    expect(status.totalCostUsd).toBe(0);
    expect(status.maxUsd).toBe(10.0);
    expect(status.remainingUsd).toBe(10.0);
    expect(status.usagePercent).toBe(0);
    expect(status.stepsCompleted).toBe(0);
    expect(status.exceeded).toBe(false);
    expect(status.unpricedSteps).toBe(0);
  });

  it("passes modelPricing to budget tracker", async () => {
    const { budget } = await createAgentTools(sandbox, {
      budget: {
        maxUsd: 5.0,
        pricingProvider: "openRouter",
        modelPricing: {
          "custom-model": { inputPerToken: 0.01, outputPerToken: 0.02 },
        },
      },
    });
    if (!budget) throw new Error("expected budget");

    // Simulate a step with the custom model to verify pricing is used
    budget.onStepFinish(
      makeStep("custom-model", { inputTokens: 10, outputTokens: 5 }),
    );

    const status = budget.getStatus();
    // 10 * 0.01 + 5 * 0.02 = 0.1 + 0.1 = 0.2
    expect(status.totalCostUsd).toBeCloseTo(0.2, 6);
    expect(status.stepsCompleted).toBe(1);
  });

  it("budget with only modelPricing does not fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockClear();

    const { budget } = await createAgentTools(sandbox, {
      budget: {
        maxUsd: 5.0,
        modelPricing: {
          "my-model": { inputPerToken: 0.01, outputPerToken: 0.02 },
        },
      },
    });

    expect(budget).toBeDefined();
    // No fetch should have been called (no pricingProvider)
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws when budget has neither pricingProvider nor modelPricing", async () => {
    await expect(
      createAgentTools(sandbox, {
        budget: { maxUsd: 5.0 },
      }),
    ).rejects.toThrow("pricingProvider or modelPricing");
  });

  it("still returns all core tools when budget is enabled", async () => {
    const { tools } = await createAgentTools(sandbox, {
      budget: { maxUsd: 5.0, pricingProvider: "openRouter" },
    });

    expect(tools.Bash).toBeDefined();
    expect(tools.Read).toBeDefined();
    expect(tools.Write).toBeDefined();
    expect(tools.Edit).toBeDefined();
    expect(tools.Glob).toBeDefined();
    expect(tools.Grep).toBeDefined();
  });
});

describe("Task tool budget auto-wiring", () => {
  /** Helper to create a mock model with known usage */
  function createMockModel(modelId = "test-model") {
    return new MockLanguageModelV3({
      modelId,
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: "Done" }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: {
            total: 100,
            noCache: 100,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 50, text: 50, reasoning: undefined },
        },
        warnings: [],
      }),
    });
  }

  /** Helper to execute a task (asserts execute is defined) */
  function executeTask(
    taskTool: ReturnType<typeof createTaskTool>,
    id: string,
    description: string,
  ) {
    if (!taskTool.execute) throw new Error("expected execute");
    return taskTool.execute(
      {
        description,
        prompt: `Do ${description}`,
        subagent_type: "general",
        system_prompt: null,
        tools: null,
      },
      { toolCallId: id, messages: [] },
    );
  }

  it("parallel task calls accumulate into a shared budget", async () => {
    const budget = createBudgetTracker(10.0, {
      modelPricing: {
        "test-model": { inputPerToken: 0.01, outputPerToken: 0.02 },
      },
    });

    const taskTool = createTaskTool({
      model: createMockModel(),
      tools: {},
      budget,
    });

    // Simulate 3 parallel task calls (orchestrator spawning concurrent subagents)
    const results = await Promise.all([
      executeTask(taskTool, "tc1", "Task 1"),
      executeTask(taskTool, "tc2", "Task 2"),
      executeTask(taskTool, "tc3", "Task 3"),
    ]);

    // All tasks should succeed
    for (const result of results) {
      expect(result).toHaveProperty("result");
      expect(result).not.toHaveProperty("error");
    }

    // Budget should reflect all 3 tasks
    const status = budget.getStatus();
    // Each task: 100 * 0.01 + 50 * 0.02 = 1.0 + 1.0 = 2.0
    // 3 tasks: 6.0 total
    expect(status.totalCostUsd).toBeCloseTo(6.0, 6);
    expect(status.stepsCompleted).toBe(3);
    expect(status.exceeded).toBe(false);
    expect(status.remainingUsd).toBeCloseTo(4.0, 6);
  });

  it("budget stopWhen halts subagent when global budget exceeded", async () => {
    // Budget of $3 — each step costs $2, so after 1 step the budget should not be exceeded,
    // but after 2 steps total across all tasks it should be exceeded
    const budget = createBudgetTracker(3.0, {
      modelPricing: {
        "test-model": { inputPerToken: 0.01, outputPerToken: 0.02 },
      },
    });

    const taskTool = createTaskTool({
      model: createMockModel(),
      tools: {},
      budget,
    });

    // First task: costs $2, budget not exceeded yet
    await executeTask(taskTool, "tc1", "First task");

    expect(budget.getStatus().totalCostUsd).toBeCloseTo(2.0, 6);
    expect(budget.getStatus().exceeded).toBe(false);

    // Second task: costs another $2, pushing total to $4 > $3 budget
    await executeTask(taskTool, "tc2", "Second task");

    // Budget should now be exceeded (total $4 > $3 limit)
    const status = budget.getStatus();
    expect(status.totalCostUsd).toBeCloseTo(4.0, 6);
    expect(status.exceeded).toBe(true);
    expect(status.stepsCompleted).toBe(2);

    // stopWhen should return true
    expect(budget.stopWhen({ steps: [] })).toBe(true);
  });
});
