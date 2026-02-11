/**
 * Budget tracking for AI agent cost management.
 *
 * Tracks cumulative cost across agentic loop steps and stops generation
 * when a budget is exceeded. Pricing is automatic via OpenRouter's free
 * public API. Model ID matching uses PostHog's proven 3-tier strategy.
 */

import type {
  LanguageModelUsage,
  StepResult,
  StopCondition,
  ToolSet,
} from "ai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  cacheReadPerToken?: number;
  cacheWritePerToken?: number;
}

export interface BudgetStatus {
  totalCostUsd: number;
  maxBudgetUsd: number;
  remainingUsd: number;
  usagePercent: number;
  stepsCompleted: number;
  exceeded: boolean;
  /** Number of steps where pricing was unavailable (cost tracked as $0). */
  unpricedSteps: number;
}

export interface BudgetTracker {
  /** Track cost for a completed step. Call from onStepFinish. */
  onStepFinish: (step: StepResult<ToolSet>) => void;
  /** Stop condition — returns true when budget exceeded. Compose with other stopWhen conditions. */
  stopWhen: StopCondition<ToolSet>;
  /** Get current budget status (cost, remaining, etc.) */
  getStatus: () => BudgetStatus;
}

// ---------------------------------------------------------------------------
// OpenRouter pricing fetch
// ---------------------------------------------------------------------------

/** Raw model entry from OpenRouter API */
interface OpenRouterModel {
  id: string;
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
}

/** Module-level cache for OpenRouter pricing */
let openRouterCache: Map<string, ModelPricing> | null = null;
/** Timestamp of last successful fetch */
let openRouterCacheTimestamp = 0;
/** Shared promise to deduplicate concurrent fetches */
let openRouterFetchPromise: Promise<Map<string, ModelPricing>> | null = null;

/** Default timeout for the OpenRouter pricing fetch (10 seconds) */
const OPENROUTER_FETCH_TIMEOUT_MS = 10_000;
/** Cache TTL for OpenRouter pricing (24 hours) */
const OPENROUTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Fetches model pricing from OpenRouter's public API.
 * Results are cached at module level. Concurrent calls are deduplicated.
 *
 * On failure, throws an error (callers decide whether to rethrow or fall back).
 */
export async function fetchOpenRouterPricing(): Promise<
  Map<string, ModelPricing>
> {
  if (
    openRouterCache &&
    Date.now() - openRouterCacheTimestamp < OPENROUTER_CACHE_TTL_MS
  ) {
    return openRouterCache;
  }
  if (openRouterFetchPromise) return openRouterFetchPromise;

  openRouterFetchPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      OPENROUTER_FETCH_TIMEOUT_MS,
    );

    try {
      let response: Response;
      try {
        response = await fetch("https://openrouter.ai/api/v1/models", {
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new Error(
            `[bashkit] OpenRouter pricing fetch timed out after ${OPENROUTER_FETCH_TIMEOUT_MS / 1000}s. ` +
              `This usually means OpenRouter is unreachable from your network. ` +
              `You can bypass this by providing modelPricing overrides in your config.`,
          );
        }
        throw new Error(
          `[bashkit] OpenRouter pricing fetch failed (network error). ` +
            `Ensure you have internet access or provide modelPricing overrides in your config. ` +
            `Original error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `[bashkit] OpenRouter pricing fetch failed: HTTP ${response.status} ${response.statusText}. ` +
            `You can bypass this by providing modelPricing overrides in your config.`,
        );
      }

      const json = (await response.json()) as { data?: OpenRouterModel[] };
      const models = json.data;
      if (!Array.isArray(models)) {
        throw new Error(
          `[bashkit] OpenRouter pricing response missing data array. ` +
            `The API may have changed. Please provide modelPricing overrides in your config.`,
        );
      }

      // Cap entries to prevent excessive memory use from a compromised endpoint.
      // OpenRouter has ~500 models today; 10,000 is generous headroom.
      // The 10s fetch timeout also limits total response size at the network level.
      const MAX_MODELS = 10_000;
      const map = new Map<string, ModelPricing>();
      for (const model of models.slice(0, MAX_MODELS)) {
        if (!model.id || !model.pricing) continue;

        const prompt = parseFloat(model.pricing.prompt ?? "");
        const completion = parseFloat(model.pricing.completion ?? "");
        if (!Number.isFinite(prompt) || !Number.isFinite(completion)) continue;
        if (prompt < 0 || completion < 0) continue;

        const pricing: ModelPricing = {
          inputPerToken: prompt,
          outputPerToken: completion,
        };

        const cacheRead = parseFloat(model.pricing.input_cache_read ?? "");
        if (Number.isFinite(cacheRead) && cacheRead >= 0)
          pricing.cacheReadPerToken = cacheRead;

        const cacheWrite = parseFloat(model.pricing.input_cache_write ?? "");
        if (Number.isFinite(cacheWrite) && cacheWrite >= 0)
          pricing.cacheWritePerToken = cacheWrite;

        map.set(model.id.toLowerCase(), pricing);
      }

      openRouterCache = map;
      openRouterCacheTimestamp = Date.now();
      return openRouterCache;
    } finally {
      clearTimeout(timeoutId);
      openRouterFetchPromise = null;
    }
  })();

  return openRouterFetchPromise;
}

/**
 * Reset the OpenRouter cache. Primarily for testing.
 * @internal
 */
export function resetOpenRouterCache(): void {
  openRouterCache = null;
  openRouterCacheTimestamp = 0;
  openRouterFetchPromise = null;
}

// ---------------------------------------------------------------------------
// Model ID matching (PostHog's 3-tier approach)
// ---------------------------------------------------------------------------

/**
 * Generates match variants for a model ID.
 * Adapted from PostHog/posthog/nodejs/src/ingestion/ai/costs/cost-model-matching.ts
 */
export function getModelMatchVariants(model: string): string[] {
  const lower = model.toLowerCase();
  const kebab = lower.replace(/[^a-z0-9]+/g, "-");
  const withoutProvider = lower.includes("/")
    ? lower.slice(lower.lastIndexOf("/") + 1)
    : lower;
  const withoutProviderKebab = withoutProvider.replace(/[^a-z0-9]+/g, "-");

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const v of [lower, kebab, withoutProvider, withoutProviderKebab]) {
    if (!seen.has(v)) {
      seen.add(v);
      variants.push(v);
    }
  }
  return variants;
}

/**
 * Searches for a model's pricing in a cost map using 3-tier matching.
 *
 * 1. Exact match (case-insensitive key lookup)
 * 2. Longest contained match: response model variant *contains* a cost entry variant
 * 3. Reverse containment: cost entry variant *contains* response model variant
 */
export function searchModelInCosts(
  model: string,
  costsMap: Map<string, ModelPricing>,
): ModelPricing | undefined {
  if (costsMap.size === 0) return undefined;

  const modelVariants = getModelMatchVariants(model);

  // Build cost entry variants (lazily, once)
  const costVariantsCache = new Map<string, string[]>();
  function getCostVariants(key: string): string[] {
    let variants = costVariantsCache.get(key);
    if (!variants) {
      variants = getModelMatchVariants(key);
      costVariantsCache.set(key, variants);
    }
    return variants;
  }

  // Tier 1: Exact match
  for (const variant of modelVariants) {
    const pricing = costsMap.get(variant);
    if (pricing) return pricing;
  }

  // Tier 2: Longest contained match (model variant contains cost variant)
  let bestMatch: ModelPricing | undefined;
  let bestMatchLength = 0;

  for (const [costKey, pricing] of costsMap) {
    const costVariants = getCostVariants(costKey);
    for (const modelVariant of modelVariants) {
      for (const costVariant of costVariants) {
        if (
          modelVariant.includes(costVariant) &&
          costVariant.length > bestMatchLength
        ) {
          bestMatch = pricing;
          bestMatchLength = costVariant.length;
        }
      }
    }
  }

  if (bestMatch) return bestMatch;

  // Tier 3: Reverse containment (cost variant contains model variant)
  let reverseMatch: ModelPricing | undefined;
  let reverseMatchLength = Infinity;

  for (const [costKey, pricing] of costsMap) {
    const costVariants = getCostVariants(costKey);
    for (const modelVariant of modelVariants) {
      for (const costVariant of costVariants) {
        if (
          costVariant.includes(modelVariant) &&
          costVariant.length < reverseMatchLength
        ) {
          reverseMatch = pricing;
          reverseMatchLength = costVariant.length;
        }
      }
    }
  }

  return reverseMatch;
}

/**
 * Finds pricing for a model, checking user overrides first then OpenRouter cache.
 * Pass a `warnedModels` set to suppress duplicate warnings per tracker instance.
 */
export function findPricingForModel(
  model: string,
  overrides?: Record<string, ModelPricing> | Map<string, ModelPricing>,
  openRouterCache?: Map<string, ModelPricing>,
  warnedModels?: Set<string>,
): ModelPricing | undefined {
  // 1. Check user overrides
  if (overrides) {
    const overrideMap =
      overrides instanceof Map
        ? overrides
        : new Map(
            Object.entries(overrides).map(([k, v]) => [k.toLowerCase(), v]),
          );
    const found = searchModelInCosts(model, overrideMap);
    if (found) return found;
  }

  // 2. Search OpenRouter cache
  if (openRouterCache) {
    const found = searchModelInCosts(model, openRouterCache);
    if (found) return found;
  }

  // 3. Warn once per model (scoped to the provided set, not module-level)
  if (warnedModels && !warnedModels.has(model.toLowerCase())) {
    warnedModels.add(model.toLowerCase());
    console.warn(
      `[bashkit] No pricing found for model "${model}". Cost will not be tracked for this step.`,
    );
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Cost calculation
// ---------------------------------------------------------------------------

/**
 * Calculates the cost of a single step based on token usage and pricing.
 */
export function calculateStepCost(
  usage: LanguageModelUsage,
  pricing: ModelPricing,
): number {
  let inputCost: number;

  const cacheRead = usage.inputTokenDetails?.cacheReadTokens;
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens;
  const noCache = usage.inputTokenDetails?.noCacheTokens;

  // Use granular cache pricing if breakdown is available
  if (cacheRead != null || cacheWrite != null || noCache != null) {
    const noCacheCost = (noCache ?? 0) * pricing.inputPerToken;
    const cacheReadCost =
      (cacheRead ?? 0) * (pricing.cacheReadPerToken ?? pricing.inputPerToken);
    const cacheWriteCost =
      (cacheWrite ?? 0) * (pricing.cacheWritePerToken ?? pricing.inputPerToken);
    inputCost = noCacheCost + cacheReadCost + cacheWriteCost;
  } else {
    // Fall back to charging all input tokens at input rate
    inputCost = (usage.inputTokens ?? 0) * pricing.inputPerToken;
  }

  const outputCost = (usage.outputTokens ?? 0) * pricing.outputPerToken;

  return inputCost + outputCost;
}

// ---------------------------------------------------------------------------
// BudgetTracker factory
// ---------------------------------------------------------------------------

/**
 * Creates a budget tracker that monitors cumulative cost across agentic loop steps.
 *
 * Pricing is looked up synchronously from a pre-fetched OpenRouter pricing map
 * and/or user-provided overrides. Use `fetchOpenRouterPricing()` to eagerly load
 * the map before creating the tracker (this is what `createAgentTools` does).
 *
 * @param maxBudgetUsd - Maximum budget in USD (must be positive)
 * @param options - Pricing sources: user overrides and/or pre-fetched OpenRouter map
 * @returns BudgetTracker instance
 *
 * @example
 * ```typescript
 * const openRouterPricing = await fetchOpenRouterPricing();
 * const budget = createBudgetTracker(5.00, { openRouterPricing });
 *
 * const result = await generateText({
 *   model,
 *   tools,
 *   stopWhen: [stepCountIs(50), budget.stopWhen],
 *   onStepFinish: (step) => {
 *     budget.onStepFinish(step);
 *     console.log(budget.getStatus());
 *   },
 * });
 * ```
 */
export function createBudgetTracker(
  maxBudgetUsd: number,
  options?: {
    modelPricing?: Record<string, ModelPricing>;
    openRouterPricing?: Map<string, ModelPricing>;
    onUnpricedModel?: (modelId: string) => void;
  },
): BudgetTracker {
  if (maxBudgetUsd <= 0) {
    throw new Error(
      `[bashkit] maxBudgetUsd must be positive, got ${maxBudgetUsd}`,
    );
  }

  // Pre-build override Map once (avoids re-creating from Record on every step)
  const overrideMap = options?.modelPricing
    ? new Map(
        Object.entries(options.modelPricing).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      )
    : undefined;
  const openRouterPricing = options?.openRouterPricing;
  const onUnpricedModel = options?.onUnpricedModel;
  const warnedModels = new Set<string>();
  // Cache pricing lookups per model ID so repeated steps skip the full search
  const pricingCache = new Map<string, ModelPricing | undefined>();

  let totalCostUsd = 0;
  let stepsCompleted = 0;
  let unpricedSteps = 0;

  const tracker: BudgetTracker = {
    onStepFinish(step: StepResult<ToolSet>): void {
      const modelId = step.response?.modelId;
      if (!modelId) {
        unpricedSteps++;
        stepsCompleted++;

        return;
      }

      let pricing: ModelPricing | undefined;
      if (pricingCache.has(modelId)) {
        pricing = pricingCache.get(modelId);
      } else {
        pricing = findPricingForModel(
          modelId,
          overrideMap,
          openRouterPricing,
          warnedModels,
        );
        pricingCache.set(modelId, pricing);
      }

      if (!pricing) {
        unpricedSteps++;
        onUnpricedModel?.(modelId);
        stepsCompleted++;

        return;
      }

      const cost = calculateStepCost(step.usage, pricing);
      totalCostUsd += cost;
      stepsCompleted++;
    },

    stopWhen(_options) {
      return totalCostUsd >= maxBudgetUsd;
    },

    getStatus(): BudgetStatus {
      const remaining = Math.max(0, maxBudgetUsd - totalCostUsd);
      return {
        totalCostUsd,
        maxBudgetUsd,
        remainingUsd: remaining,
        usagePercent: (totalCostUsd / maxBudgetUsd) * 100,
        stepsCompleted,
        exceeded: totalCostUsd >= maxBudgetUsd,
        unpricedSteps,
      };
    },
  };

  return tracker;
}
