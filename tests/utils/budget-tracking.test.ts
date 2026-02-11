import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  getModelMatchVariants,
  searchModelInCosts,
  findPricingForModel,
  calculateStepCost,
  createBudgetTracker,
  fetchOpenRouterPricing,
  resetOpenRouterCache,
  type ModelPricing,
} from "@/utils/budget-tracking";
import type { LanguageModelUsage } from "ai";
import { makeUsage, makeStep } from "@test/helpers";

const TEST_PRICING: Record<string, ModelPricing> = {
  "test-model": { inputPerToken: 0.001, outputPerToken: 0.002 },
};

// ---------------------------------------------------------------------------
// getModelMatchVariants
// ---------------------------------------------------------------------------

describe("getModelMatchVariants", () => {
  it("returns lowercased original", () => {
    const variants = getModelMatchVariants("Anthropic/Claude-Sonnet-4-5");
    expect(variants).toContain("anthropic/claude-sonnet-4-5");
  });

  it("returns kebab-normalized variant", () => {
    const variants = getModelMatchVariants("anthropic/claude-sonnet-4-5");
    expect(variants).toContain("anthropic-claude-sonnet-4-5");
  });

  it("returns without-provider variant", () => {
    const variants = getModelMatchVariants("anthropic/claude-sonnet-4-5");
    expect(variants).toContain("claude-sonnet-4-5");
  });

  it("deduplicates variants", () => {
    const variants = getModelMatchVariants("claude-sonnet-4-5");
    const unique = [...new Set(variants)];
    expect(variants).toEqual(unique);
  });

  it("handles model without provider prefix", () => {
    const variants = getModelMatchVariants("gpt-4o");
    expect(variants).toContain("gpt-4o");
  });
});

// ---------------------------------------------------------------------------
// searchModelInCosts
// ---------------------------------------------------------------------------

describe("searchModelInCosts", () => {
  const costsMap = new Map<string, ModelPricing>([
    [
      "anthropic/claude-sonnet-4-5",
      { inputPerToken: 0.000003, outputPerToken: 0.000015 },
    ],
    ["openai/gpt-4o", { inputPerToken: 0.0000025, outputPerToken: 0.00001 }],
    [
      "google/gemini-2.0-flash",
      { inputPerToken: 0.0000001, outputPerToken: 0.0000004 },
    ],
  ]);

  it("finds exact match (case-insensitive)", () => {
    const result = searchModelInCosts("Anthropic/Claude-Sonnet-4-5", costsMap);
    expect(result).toEqual({
      inputPerToken: 0.000003,
      outputPerToken: 0.000015,
    });
  });

  it("finds match without provider prefix", () => {
    const result = searchModelInCosts("claude-sonnet-4-5", costsMap);
    expect(result).toBeDefined();
    expect(result?.inputPerToken).toBe(0.000003);
  });

  it("finds match with version suffix (longest contained)", () => {
    const result = searchModelInCosts("claude-sonnet-4-5-20250929", costsMap);
    expect(result).toBeDefined();
    expect(result?.inputPerToken).toBe(0.000003);
  });

  it("returns undefined for unknown model", () => {
    const result = searchModelInCosts("unknown/model-xyz", costsMap);
    expect(result).toBeUndefined();
  });

  it("returns undefined for empty cost map", () => {
    const result = searchModelInCosts("anthropic/claude-sonnet-4-5", new Map());
    expect(result).toBeUndefined();
  });

  it("longest match wins over shorter match", () => {
    const map = new Map<string, ModelPricing>([
      ["claude", { inputPerToken: 0.001, outputPerToken: 0.002 }],
      [
        "anthropic/claude-sonnet-4-5",
        { inputPerToken: 0.000003, outputPerToken: 0.000015 },
      ],
    ]);
    const result = searchModelInCosts(
      "anthropic/claude-sonnet-4-5-20250929",
      map,
    );
    expect(result?.inputPerToken).toBe(0.000003);
  });
});

// ---------------------------------------------------------------------------
// findPricingForModel
// ---------------------------------------------------------------------------

describe("findPricingForModel", () => {
  it("user override takes priority over OpenRouter cache", () => {
    const overrides: Record<string, ModelPricing> = {
      "custom-model": { inputPerToken: 0.01, outputPerToken: 0.02 },
    };
    const openRouterCache = new Map<string, ModelPricing>([
      ["custom-model", { inputPerToken: 0.001, outputPerToken: 0.002 }],
    ]);

    const result = findPricingForModel("custom-model", overrides, openRouterCache);
    expect(result?.inputPerToken).toBe(0.01);
  });

  it("falls back to OpenRouter cache when no override", () => {
    const openRouterCache = new Map<string, ModelPricing>([
      [
        "anthropic/claude-sonnet-4-5",
        { inputPerToken: 0.000003, outputPerToken: 0.000015 },
      ],
    ]);

    const result = findPricingForModel("claude-sonnet-4-5", undefined, openRouterCache);
    expect(result).toBeDefined();
    expect(result?.inputPerToken).toBe(0.000003);
  });

  it("returns undefined and warns for unknown model", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const warned = new Set<string>();
    const result = findPricingForModel(
      "totally-unknown-model-12345",
      undefined,
      new Map(),
      warned,
    );
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("No pricing found"),
    );
    warnSpy.mockRestore();
  });

  it("does not warn when no warnedModels set is provided", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    findPricingForModel("some-model", undefined, new Map());
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns only once per model per warnedModels set", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const warned = new Set<string>();
    findPricingForModel("repeat-model", undefined, new Map(), warned);
    findPricingForModel("repeat-model", undefined, new Map(), warned);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// calculateStepCost
// ---------------------------------------------------------------------------

describe("calculateStepCost", () => {
  const pricing: ModelPricing = {
    inputPerToken: 0.000003,
    outputPerToken: 0.000015,
    cacheReadPerToken: 0.0000003,
    cacheWritePerToken: 0.00000375,
  };

  it("calculates basic input + output cost", () => {
    const usage = makeUsage({
      inputTokens: 1000,
      outputTokens: 500,
    });
    const cost = calculateStepCost(usage, pricing);
    // 1000 * 0.000003 + 500 * 0.000015 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it("uses granular cache pricing when breakdown available", () => {
    const usage = makeUsage({
      inputTokens: 1000,
      inputTokenDetails: {
        noCacheTokens: 200,
        cacheReadTokens: 700,
        cacheWriteTokens: 100,
      },
      outputTokens: 500,
    });
    const cost = calculateStepCost(usage, pricing);
    // noCache: 200 * 0.000003 = 0.0006
    // cacheRead: 700 * 0.0000003 = 0.00021
    // cacheWrite: 100 * 0.00000375 = 0.000375
    // output: 500 * 0.000015 = 0.0075
    // total = 0.008685
    expect(cost).toBeCloseTo(0.008685, 6);
  });

  it("falls back to input rate without cache breakdown", () => {
    const usage = makeUsage({
      inputTokens: 1000,
      outputTokens: 500,
    });
    const noCachePricing: ModelPricing = {
      inputPerToken: 0.000003,
      outputPerToken: 0.000015,
    };
    const cost = calculateStepCost(usage, noCachePricing);
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it("handles zero tokens", () => {
    const usage = makeUsage({
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(calculateStepCost(usage, pricing)).toBe(0);
  });

  it("handles undefined tokens gracefully", () => {
    const usage = makeUsage({
      inputTokens: undefined,
      outputTokens: undefined,
    });
    expect(calculateStepCost(usage, pricing)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchOpenRouterPricing
// ---------------------------------------------------------------------------

describe("fetchOpenRouterPricing", () => {
  beforeEach(() => {
    resetOpenRouterCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetOpenRouterCache();
  });

  it("parses successful response into pricing map", async () => {
    const mockResponse = {
      data: [
        {
          id: "anthropic/claude-sonnet-4-5",
          pricing: {
            prompt: "0.000003",
            completion: "0.000015",
            input_cache_read: "0.0000003",
            input_cache_write: "0.00000375",
          },
        },
        {
          id: "openai/gpt-4o",
          pricing: {
            prompt: "0.0000025",
            completion: "0.00001",
          },
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const map = await fetchOpenRouterPricing();
    expect(map.size).toBe(2);

    const claude = map.get("anthropic/claude-sonnet-4-5");
    expect(claude).toBeDefined();
    expect(claude?.inputPerToken).toBe(0.000003);
    expect(claude?.outputPerToken).toBe(0.000015);
    expect(claude?.cacheReadPerToken).toBe(0.0000003);
    expect(claude?.cacheWritePerToken).toBe(0.00000375);

    const gpt = map.get("openai/gpt-4o");
    expect(gpt).toBeDefined();
    expect(gpt?.cacheReadPerToken).toBeUndefined();
  });

  it("rejects negative pricing values", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "neg/model",
            pricing: { prompt: "-0.001", completion: "0.01" },
          },
          {
            id: "valid/model",
            pricing: { prompt: "0.001", completion: "0.01" },
          },
        ],
      }),
    } as Response);

    const map = await fetchOpenRouterPricing();
    expect(map.has("neg/model")).toBe(false);
    expect(map.has("valid/model")).toBe(true);
  });

  it("rejects Infinity pricing values", async () => {
    resetOpenRouterCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "inf/model",
            pricing: { prompt: "Infinity", completion: "0.01" },
          },
        ],
      }),
    } as Response);

    const map = await fetchOpenRouterPricing();
    expect(map.has("inf/model")).toBe(false);
  });

  it("rejects negative cache pricing but keeps valid base pricing", async () => {
    resetOpenRouterCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "cache/model",
            pricing: {
              prompt: "0.001",
              completion: "0.01",
              input_cache_read: "-0.0001",
              input_cache_write: "0.002",
            },
          },
        ],
      }),
    } as Response);

    const map = await fetchOpenRouterPricing();
    const pricing = map.get("cache/model");
    expect(pricing).toBeDefined();
    expect(pricing?.cacheReadPerToken).toBeUndefined(); // negative rejected
    expect(pricing?.cacheWritePerToken).toBe(0.002); // valid kept
  });

  it("throws on network error with actionable message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    await expect(fetchOpenRouterPricing()).rejects.toThrow("network error");
    await resetOpenRouterCache();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );
    await expect(fetchOpenRouterPricing()).rejects.toThrow(
      "modelPricing overrides",
    );
  });

  it("throws on timeout with actionable message", async () => {
    const abortError = new DOMException(
      "The operation was aborted",
      "AbortError",
    );
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    await expect(fetchOpenRouterPricing()).rejects.toThrow("timed out");
  });

  it("throws on non-OK response with status code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);

    await expect(fetchOpenRouterPricing()).rejects.toThrow("HTTP 500");
  });

  it("throws on malformed JSON with actionable message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ unexpected: "shape" }),
    } as Response);

    await expect(fetchOpenRouterPricing()).rejects.toThrow(
      "missing data array",
    );
  });

  it("caches result across calls (no second fetch)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response);

    await fetchOpenRouterPricing();
    await fetchOpenRouterPricing();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response);

    const [a, b] = await Promise.all([
      fetchOpenRouterPricing(),
      fetchOpenRouterPricing(),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("re-fetches after cache TTL expires", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response);

    await fetchOpenRouterPricing();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance time past the 24-hour TTL
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);

    await fetchOpenRouterPricing();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// BudgetTracker
// ---------------------------------------------------------------------------

describe("createBudgetTracker", () => {
  it("throws on negative maxBudgetUsd", () => {
    expect(() => createBudgetTracker(-1)).toThrow("must be positive");
  });

  it("throws on zero maxBudgetUsd", () => {
    expect(() => createBudgetTracker(0)).toThrow("must be positive");
  });

  it("accumulates cost across multiple onStepFinish calls", () => {
    const tracker = createBudgetTracker(10.0, {
      modelPricing: TEST_PRICING,
    });

    tracker.onStepFinish(
      makeStep("test-model", { inputTokens: 100, outputTokens: 50 }),
    );
    tracker.onStepFinish(
      makeStep("test-model", { inputTokens: 200, outputTokens: 100 }),
    );

    const status = tracker.getStatus();
    // Step 1: 100*0.001 + 50*0.002 = 0.1 + 0.1 = 0.2
    // Step 2: 200*0.001 + 100*0.002 = 0.2 + 0.2 = 0.4
    // Total: 0.6
    expect(status.totalCostUsd).toBeCloseTo(0.6, 6);
    expect(status.stepsCompleted).toBe(2);
  });

  it("getStatus reflects accumulated cost", () => {
    const tracker = createBudgetTracker(1.0, {
      modelPricing: TEST_PRICING,
    });

    tracker.onStepFinish(
      makeStep("test-model", { inputTokens: 100, outputTokens: 50 }),
    );

    const status = tracker.getStatus();
    expect(status.maxBudgetUsd).toBe(1.0);
    expect(status.totalCostUsd).toBeCloseTo(0.2, 6);
    expect(status.remainingUsd).toBeCloseTo(0.8, 6);
    expect(status.usagePercent).toBeCloseTo(20, 1);
    expect(status.exceeded).toBe(false);
  });

  it("stopWhen returns false when under budget", () => {
    const tracker = createBudgetTracker(10.0, {
      modelPricing: TEST_PRICING,
    });

    tracker.onStepFinish(
      makeStep("test-model", { inputTokens: 100, outputTokens: 50 }),
    );

    expect(tracker.stopWhen({ steps: [] })).toBe(false);
  });

  it("stopWhen returns true when budget exceeded", () => {
    const tracker = createBudgetTracker(0.001, {
      modelPricing: {
        "test-model": { inputPerToken: 0.01, outputPerToken: 0.02 },
      },
    });

    tracker.onStepFinish(
      makeStep("test-model", { inputTokens: 100, outputTokens: 50 }),
    );

    // Cost: 100*0.01 + 50*0.02 = 1.0 + 1.0 = 2.0, exceeds 0.001
    expect(tracker.stopWhen({ steps: [] })).toBe(true);
    expect(tracker.getStatus().exceeded).toBe(true);
  });

  it("handles step with no modelId gracefully", () => {
    const tracker = createBudgetTracker(10.0, {
      modelPricing: TEST_PRICING,
    });

    const step = makeStep("", { inputTokens: 100, outputTokens: 50 });
    // biome-ignore lint/suspicious/noExplicitAny: test helper override
    (step as unknown as { response: any }).response = {
      modelId: undefined,
      id: "r",
      timestamp: new Date(),
    };

    tracker.onStepFinish(step);
    expect(tracker.getStatus().stepsCompleted).toBe(1);
    expect(tracker.getStatus().totalCostUsd).toBe(0);
  });

  it("uses openRouterPricing map when provided", () => {
    const orPricing = new Map<string, ModelPricing>([
      ["or-model", { inputPerToken: 0.005, outputPerToken: 0.01 }],
    ]);
    const tracker = createBudgetTracker(10.0, {
      openRouterPricing: orPricing,
    });

    tracker.onStepFinish(
      makeStep("or-model", { inputTokens: 100, outputTokens: 50 }),
    );

    // 100*0.005 + 50*0.01 = 0.5 + 0.5 = 1.0
    expect(tracker.getStatus().totalCostUsd).toBeCloseTo(1.0, 6);
  });

  it("modelPricing overrides take priority over openRouterPricing", () => {
    const orPricing = new Map<string, ModelPricing>([
      ["my-model", { inputPerToken: 0.001, outputPerToken: 0.002 }],
    ]);
    const tracker = createBudgetTracker(10.0, {
      modelPricing: {
        "my-model": { inputPerToken: 0.01, outputPerToken: 0.02 },
      },
      openRouterPricing: orPricing,
    });

    tracker.onStepFinish(
      makeStep("my-model", { inputTokens: 100, outputTokens: 50 }),
    );

    // Uses override: 100*0.01 + 50*0.02 = 1.0 + 1.0 = 2.0
    expect(tracker.getStatus().totalCostUsd).toBeCloseTo(2.0, 6);
  });

  // -------------------------------------------------------------------------
  // unpricedSteps + onUnpricedModel
  // -------------------------------------------------------------------------

  it("priced steps have unpricedSteps: 0", () => {
    const tracker = createBudgetTracker(10.0, {
      modelPricing: TEST_PRICING,
    });

    tracker.onStepFinish(
      makeStep("test-model", { inputTokens: 100, outputTokens: 50 }),
    );

    expect(tracker.getStatus().unpricedSteps).toBe(0);
  });

  it("unknown model increments unpricedSteps", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createBudgetTracker(10.0, {
      modelPricing: TEST_PRICING,
    });

    tracker.onStepFinish(
      makeStep("totally-unknown-model", { inputTokens: 100, outputTokens: 50 }),
    );

    expect(tracker.getStatus().unpricedSteps).toBe(1);
    expect(tracker.getStatus().stepsCompleted).toBe(1);
    expect(tracker.getStatus().totalCostUsd).toBe(0);
    warnSpy.mockRestore();
  });

  it("no modelId increments unpricedSteps", () => {
    const tracker = createBudgetTracker(10.0, {
      modelPricing: TEST_PRICING,
    });

    const step = makeStep("", { inputTokens: 100, outputTokens: 50 });
    // biome-ignore lint/suspicious/noExplicitAny: test helper override
    (step as unknown as { response: any }).response = {
      modelId: undefined,
      id: "r",
      timestamp: new Date(),
    };

    tracker.onStepFinish(step);
    expect(tracker.getStatus().unpricedSteps).toBe(1);
  });

  it("onUnpricedModel callback fires with the model ID", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const callback = vi.fn();
    const tracker = createBudgetTracker(10.0, {
      modelPricing: TEST_PRICING,
      onUnpricedModel: callback,
    });

    tracker.onStepFinish(
      makeStep("mystery-model", { inputTokens: 100, outputTokens: 50 }),
    );

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("mystery-model");
    warnSpy.mockRestore();
  });

  it("onUnpricedModel can throw to halt execution", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createBudgetTracker(10.0, {
      modelPricing: TEST_PRICING,
      onUnpricedModel: (modelId) => {
        throw new Error(`Unpriced model not allowed: ${modelId}`);
      },
    });

    expect(() =>
      tracker.onStepFinish(
        makeStep("mystery-model", { inputTokens: 100, outputTokens: 50 }),
      ),
    ).toThrow("Unpriced model not allowed: mystery-model");
    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Parallel task shared budget
  // -------------------------------------------------------------------------

  it("parallel tasks accumulate into a shared budget", async () => {
    const tracker = createBudgetTracker(10.0, {
      modelPricing: {
        "test-model": { inputPerToken: 0.01, outputPerToken: 0.02 },
      },
    });

    // Simulate 10 parallel tasks each reporting a step concurrently
    // (like 10 subagents spawned by the Task tool sharing one budget)
    const tasks = Array.from({ length: 10 }, () =>
      Promise.resolve().then(() => {
        tracker.onStepFinish(
          makeStep("test-model", { inputTokens: 100, outputTokens: 50 }),
        );
      }),
    );

    await Promise.all(tasks);

    const status = tracker.getStatus();
    // Each step: 100*0.01 + 50*0.02 = 1.0 + 1.0 = 2.0
    // 10 steps total: 20.0
    expect(status.totalCostUsd).toBeCloseTo(20.0, 6);
    expect(status.stepsCompleted).toBe(10);
    expect(status.exceeded).toBe(true);
  });

  it("stopWhen triggers for parallel tasks when shared budget exceeded", async () => {
    const tracker = createBudgetTracker(5.0, {
      modelPricing: {
        "test-model": { inputPerToken: 0.01, outputPerToken: 0.02 },
      },
    });

    // Simulate orchestrator spending $0.50
    tracker.onStepFinish(
      makeStep("test-model", { inputTokens: 50, outputTokens: 0 }),
    );
    // 50 * 0.01 = 0.50
    expect(tracker.getStatus().totalCostUsd).toBeCloseTo(0.5, 6);
    expect(tracker.stopWhen({ steps: [] })).toBe(false);

    // Simulate 3 parallel tasks each spending $2.00
    const tasks = Array.from({ length: 3 }, () =>
      Promise.resolve().then(() => {
        tracker.onStepFinish(
          makeStep("test-model", { inputTokens: 100, outputTokens: 50 }),
        );
      }),
    );
    await Promise.all(tasks);

    // Orchestrator: $0.50 + 3 tasks * $2.00 = $6.50 > $5.00
    expect(tracker.getStatus().totalCostUsd).toBeCloseTo(6.5, 6);
    expect(tracker.stopWhen({ steps: [] })).toBe(true);
    expect(tracker.getStatus().exceeded).toBe(true);
    expect(tracker.getStatus().stepsCompleted).toBe(4);
  });
});
