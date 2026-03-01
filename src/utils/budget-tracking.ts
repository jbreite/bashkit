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

export interface ModelInfo {
  pricing: ModelPricing;
  contextLength: number;
}

export interface BudgetStatus {
  totalCostUsd: number;
  maxUsd: number;
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
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
}

/** Module-level cache for OpenRouter pricing (derived from models cache) */
let openRouterPricingCache: Map<string, ModelPricing> | null = null;
/** Module-level cache for OpenRouter models (pricing + context length) */
let openRouterModelsCache: Map<string, ModelInfo> | null = null;
/** Timestamp of last successful fetch */
let openRouterCacheTimestamp = 0;
/** Shared promise to deduplicate concurrent fetches */
let openRouterFetchPromise: Promise<Map<string, ModelInfo>> | null = null;

/** Default timeout for the OpenRouter pricing fetch (10 seconds) */
const OPENROUTER_FETCH_TIMEOUT_MS = 10_000;
/** Cache TTL for OpenRouter pricing (24 hours) */
const OPENROUTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Shared fetch that populates both pricing and models caches.
 * Returns the models map (pricing + contextLength). The pricing-only
 * map is derived and cached as a side effect.
 */
async function fetchOpenRouterData(
  apiKey?: string,
): Promise<Map<string, ModelInfo>> {
  if (
    openRouterModelsCache &&
    Date.now() - openRouterCacheTimestamp < OPENROUTER_CACHE_TTL_MS
  ) {
    return openRouterModelsCache;
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
        const headers: Record<string, string> = {};
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }
        response = await fetch("https://openrouter.ai/api/v1/models", {
          signal: controller.signal,
          headers,
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
      const modelsMap = new Map<string, ModelInfo>();
      const pricingMap = new Map<string, ModelPricing>();

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

        const key = model.id.toLowerCase();
        pricingMap.set(key, pricing);

        const contextLength = model.context_length;
        if (
          typeof contextLength === "number" &&
          Number.isFinite(contextLength) &&
          contextLength > 0
        ) {
          modelsMap.set(key, { pricing, contextLength });
        } else {
          // Still include models without context_length (with 0 as sentinel)
          modelsMap.set(key, { pricing, contextLength: 0 });
        }
      }

      openRouterModelsCache = modelsMap;
      openRouterPricingCache = pricingMap;
      openRouterCacheTimestamp = Date.now();
      return openRouterModelsCache;
    } finally {
      clearTimeout(timeoutId);
      openRouterFetchPromise = null;
    }
  })();

  return openRouterFetchPromise;
}

/**
 * Fetches model pricing from OpenRouter's public API.
 * Results are cached at module level. Concurrent calls are deduplicated.
 *
 * On failure, throws an error (callers decide whether to rethrow or fall back).
 */
export async function fetchOpenRouterPricing(
  apiKey?: string,
): Promise<Map<string, ModelPricing>> {
  // If we already have a valid pricing cache, return it directly
  if (
    openRouterPricingCache &&
    Date.now() - openRouterCacheTimestamp < OPENROUTER_CACHE_TTL_MS
  ) {
    return openRouterPricingCache;
  }
  // Delegate to the shared fetch, then return the pricing-only map
  await fetchOpenRouterData(apiKey);
  return openRouterPricingCache!;
}

/**
 * Fetches model info (pricing + context length) from OpenRouter's public API.
 * Results are cached at module level. Concurrent calls are deduplicated.
 * Shares the same fetch and cache as `fetchOpenRouterPricing`.
 *
 * On failure, throws an error (callers decide whether to rethrow or fall back).
 */
export async function fetchOpenRouterModels(
  apiKey?: string,
): Promise<Map<string, ModelInfo>> {
  return fetchOpenRouterData(apiKey);
}

/**
 * Reset the OpenRouter cache. Primarily for testing.
 * @internal
 */
export function resetOpenRouterCache(): void {
  openRouterPricingCache = null;
  openRouterModelsCache = null;
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
 * Looks up a model's context length from the models map using the same
 * 3-tier matching strategy as pricing lookup (exact, contained, reverse).
 *
 * Returns `undefined` if the model is not found or has no context length data.
 */
export function getModelContextLength(
  model: string,
  modelsMap: Map<string, ModelInfo>,
): number | undefined {
  if (modelsMap.size === 0) return undefined;

  // Reuse searchModelInCosts by projecting ModelInfo into a temporary Map<string, ModelPricing>
  // and then using the matched key to look up context length.
  // Instead, we duplicate the 3-tier logic inline to avoid building a temporary map.

  const modelVariants = getModelMatchVariants(model);

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
    const info = modelsMap.get(variant);
    if (info && info.contextLength > 0) return info.contextLength;
  }

  // Tier 2: Longest contained match (model variant contains cost variant)
  let bestInfo: ModelInfo | undefined;
  let bestMatchLength = 0;

  for (const [costKey, info] of modelsMap) {
    if (info.contextLength <= 0) continue;
    const costVariants = getCostVariants(costKey);
    for (const modelVariant of modelVariants) {
      for (const costVariant of costVariants) {
        if (
          modelVariant.includes(costVariant) &&
          costVariant.length > bestMatchLength
        ) {
          bestInfo = info;
          bestMatchLength = costVariant.length;
        }
      }
    }
  }

  if (bestInfo) return bestInfo.contextLength;

  // Tier 3: Reverse containment (cost variant contains model variant)
  let reverseInfo: ModelInfo | undefined;
  let reverseMatchLength = Infinity;

  for (const [costKey, info] of modelsMap) {
    if (info.contextLength <= 0) continue;
    const costVariants = getCostVariants(costKey);
    for (const modelVariant of modelVariants) {
      for (const costVariant of costVariants) {
        if (
          costVariant.includes(modelVariant) &&
          costVariant.length < reverseMatchLength
        ) {
          reverseInfo = info;
          reverseMatchLength = costVariant.length;
        }
      }
    }
  }

  return reverseInfo?.contextLength;
}

/**
 * Finds pricing for a model, checking user overrides first then OpenRouter cache.
 * Pass a `warnedModels` set to suppress duplicate warnings per tracker instance.
 */
export function findPricingForModel(
  model: string,
  options?: {
    overrides?: Record<string, ModelPricing> | Map<string, ModelPricing>;
    openRouterCache?: Map<string, ModelPricing>;
    warnedModels?: Set<string>;
  },
): ModelPricing | undefined {
  // 1. Check user overrides
  if (options?.overrides) {
    const overrideMap =
      options.overrides instanceof Map
        ? options.overrides
        : new Map(
            Object.entries(options.overrides).map(([k, v]) => [
              k.toLowerCase(),
              v,
            ]),
          );
    const found = searchModelInCosts(model, overrideMap);
    if (found) return found;
  }

  // 2. Search OpenRouter cache
  if (options?.openRouterCache) {
    const found = searchModelInCosts(model, options.openRouterCache);
    if (found) return found;
  }

  // 3. Warn once per model (scoped to the provided set, not module-level)
  if (options?.warnedModels && !options.warnedModels.has(model.toLowerCase())) {
    options.warnedModels.add(model.toLowerCase());
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
 * @param maxUsd - Maximum budget in USD (must be positive)
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
  maxUsd: number,
  options?: {
    modelPricing?: Record<string, ModelPricing>;
    openRouterPricing?: Map<string, ModelPricing>;
    onUnpricedModel?: (modelId: string) => void;
  },
): BudgetTracker {
  if (maxUsd <= 0) {
    throw new Error(`[bashkit] maxUsd must be positive, got ${maxUsd}`);
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
        pricing = findPricingForModel(modelId, {
          overrides: overrideMap,
          openRouterCache: openRouterPricing,
          warnedModels,
        });
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
      return totalCostUsd >= maxUsd;
    },

    getStatus(): BudgetStatus {
      const remaining = Math.max(0, maxUsd - totalCostUsd);
      return {
        totalCostUsd,
        maxUsd,
        remainingUsd: remaining,
        usagePercent: (totalCostUsd / maxUsd) * 100,
        stepsCompleted,
        exceeded: totalCostUsd >= maxUsd,
        unpricedSteps,
      };
    },
  };

  return tracker;
}
