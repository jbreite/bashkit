import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createAgentTools } from "@/tools/index";
import { resetOpenRouterCache } from "@/utils/budget-tracking";
import { createMockSandbox, makeStep, type MockSandbox } from "@test/helpers";

/** Mock OpenRouter response with minimal valid pricing + context length data */
const MOCK_OPENROUTER_RESPONSE = {
  data: [
    {
      id: "anthropic/claude-sonnet-4-5",
      context_length: 200000,
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

  it("throws when budget has neither modelRegistry, pricingProvider, nor modelPricing", async () => {
    await expect(
      createAgentTools(sandbox, {
        budget: { maxUsd: 5.0 },
      }),
    ).rejects.toThrow("modelRegistry, pricingProvider, or modelPricing");
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

  it("modelRegistry config returns openRouterModels in result", async () => {
    const { openRouterModels } = await createAgentTools(sandbox, {
      modelRegistry: { provider: "openRouter" },
    });

    expect(openRouterModels).toBeInstanceOf(Map);
    expect(openRouterModels!.has("anthropic/claude-sonnet-4-5")).toBe(true);

    if (!openRouterModels) throw new Error("expected openRouterModels");

    const model = openRouterModels.get("anthropic/claude-sonnet-4-5")!;
    expect(model.contextLength).toBe(200000);
    expect(model.pricing.inputPerToken).toBe(0.000003);
    expect(model.pricing.outputPerToken).toBe(0.000015);
  });

  it("modelRegistry without budget still fetches and returns models", async () => {
    const { openRouterModels, budget } = await createAgentTools(sandbox, {
      modelRegistry: { provider: "openRouter" },
    });

    expect(openRouterModels).toBeInstanceOf(Map);
    expect(openRouterModels!.size).toBeGreaterThan(0);
    expect(budget).toBeUndefined();
  });

  it("modelRegistry + budget shares one fetch (single fetch call)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockClear();

    const { openRouterModels, budget } = await createAgentTools(sandbox, {
      modelRegistry: { provider: "openRouter" },
      budget: { maxUsd: 5.0 },
    });

    expect(openRouterModels).toBeInstanceOf(Map);
    expect(budget).toBeDefined();
    // Only one fetch call despite both modelRegistry and budget needing data
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("legacy pricingProvider still works and also returns openRouterModels", async () => {
    const { openRouterModels, budget } = await createAgentTools(sandbox, {
      budget: { maxUsd: 5.0, pricingProvider: "openRouter" },
    });

    expect(budget).toBeDefined();
    expect(openRouterModels).toBeInstanceOf(Map);
    expect(openRouterModels!.has("anthropic/claude-sonnet-4-5")).toBe(true);
  });

  it("modelRegistry satisfies budget pricing requirement (no pricingProvider or modelPricing needed)", async () => {
    const { budget } = await createAgentTools(sandbox, {
      modelRegistry: { provider: "openRouter" },
      budget: { maxUsd: 5.0 },
    });

    expect(budget).toBeDefined();
    const status = budget!.getStatus();
    expect(status.maxUsd).toBe(5.0);
    expect(status.totalCostUsd).toBe(0);
  });
});
