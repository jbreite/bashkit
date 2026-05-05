import type { LanguageModel, Tool, ToolSet } from "ai";
import type { CacheStore } from "./cache/types";
import type { ContextLayer } from "./context/index";
import type { ExecutionPolicyConfig } from "./context/execution-policy";
import type { OutputPolicyConfig } from "./context/output-policy";
import type { SkillMetadata } from "./skills/types";
import type { ModelPricing } from "./utils/budget-tracking";

/**
 * SDK tool options picked from the Tool type.
 * This automatically adapts to the user's installed AI SDK version.
 * - v5 users get v5 options (if any)
 * - v6 users get v6 options (needsApproval, strict, etc.)
 *
 * Uses `any` for input/output to allow typed needsApproval functions.
 */
export type SDKToolOptions = Partial<
  Pick<Tool<any, any>, "strict" | "needsApproval" | "providerOptions">
>;

/**
 * Configuration for sandbox-based tools.
 * Extends AI SDK tool options for version-appropriate type safety.
 */
export type ToolConfig = {
  // Sandbox-specific options
  timeout?: number;
  maxFileSize?: number;
  maxOutputLength?: number;
  maxLineLength?: number;
  allowedPaths?: string[];
  blockedCommands?: string[];
} & SDKToolOptions;

export type GrepToolConfig = ToolConfig;

/**
 * Supported web search providers.
 * Currently only 'parallel' is implemented.
 * Add new providers here as union types (e.g., 'parallel' | 'serper' | 'tavily')
 */
export type WebSearchProvider = "parallel";

/**
 * Supported web fetch providers.
 * Currently only 'parallel' is implemented.
 * Add new providers here as union types (e.g., 'parallel' | 'firecrawl' | 'jina')
 */
export type WebFetchProvider = "parallel";

export type WebSearchConfig = {
  /** Provider to use for web search. Default: 'parallel' */
  provider?: WebSearchProvider;
  apiKey: string;
} & SDKToolOptions;

export type WebFetchConfig = {
  /** Provider to use for web fetching. Default: 'parallel' */
  provider?: WebFetchProvider;
  apiKey: string;
  model: LanguageModel;
} & SDKToolOptions;

export type AskUserConfig = SDKToolOptions;

export type SkillConfig = {
  /** Map of skill name to metadata */
  skills: Record<string, SkillMetadata>;
  /** Callback when a skill is activated */
  onActivate?: (
    skill: SkillMetadata,
    instructions: string,
  ) => void | Promise<void>;
};

/**
 * Cache configuration for tool result caching.
 *
 * @example
 * ```typescript
 * // Enable with defaults (LRU cache, 5min TTL, safe tools only)
 * cache: true
 *
 * // Custom cache store
 * cache: myRedisStore
 *
 * // Per-tool control
 * cache: { Read: true, Glob: true, Bash: false }
 *
 * // Full options
 * cache: { store: myStore, ttl: 600000, debug: true, Read: true }
 * ```
 */
export type CacheConfig =
  | boolean // true = LRU with defaults (safe tools only)
  | CacheStore // custom store for all default tools
  | {
      /** Custom cache store (default: LRUCacheStore) */
      store?: CacheStore;
      /** TTL in milliseconds (default: 5 minutes) */
      ttl?: number;
      /** Enable debug logging for cache hits/misses */
      debug?: boolean;
      /** Callback when cache hit occurs */
      onHit?: (toolName: string, key: string) => void;
      /** Callback when cache miss occurs */
      onMiss?: (toolName: string, key: string) => void;
      /** Custom key generator for cache keys */
      keyGenerator?: (toolName: string, params: unknown) => string;
      /** Per-tool overrides - any tool name can be enabled/disabled */
      [toolName: string]:
        | boolean
        | CacheStore
        | number
        | ((toolName: string, key: string) => void)
        | ((toolName: string, params: unknown) => string)
        | undefined;
    };

/**
 * Supported pricing providers for automatic model cost lookup.
 */
export type PricingProvider = "openRouter";

/**
 * Supported model registry providers.
 * Add new providers here as union types (e.g., 'openRouter' | 'together')
 */
export type ModelRegistryProvider = "openRouter";

/**
 * Configuration for fetching model info (pricing + context lengths) from a provider.
 * Used by budget tracking and compaction.
 */
export type ModelRegistryConfig = {
  /** Provider to fetch model info from */
  provider: ModelRegistryProvider;
  /** API key for the provider (optional, passed as bearer token) */
  apiKey?: string;
};

/**
 * Budget tracking configuration.
 * At least one of `pricingProvider`, `modelPricing`, or top-level `modelRegistry` must be provided.
 */
export type BudgetConfig = {
  /** Maximum budget in USD (must be positive) */
  maxUsd: number;
  /**
   * Pricing provider for automatic model cost lookup. Omit to skip fetching.
   * @deprecated Use top-level `modelRegistry` instead.
   */
  pricingProvider?: PricingProvider;
  /**
   * API key for the pricing provider. Passed as bearer token.
   * @deprecated Use top-level `modelRegistry` instead.
   */
  apiKey?: string;
  /** Per-model pricing overrides (always highest priority over provider data) */
  modelPricing?: Record<string, ModelPricing>;
};

/**
 * Context layer configuration. Opt-in — if not provided, tools work as they do today.
 * When provided, wraps all tools (bashkit + extraTools) with execution and output policies.
 */
export interface ContextConfig {
  /** Execution policy. Controls which tools are blocked based on state (e.g., plan mode). */
  executionPolicy?: ExecutionPolicyConfig;
  /**
   * Output policy. Controls truncation behavior and redirection hints.
   * Set to false to disable. Enabled by default when context is provided.
   */
  outputPolicy?: OutputPolicyConfig | false;
  /**
   * Extra tools to include alongside bashkit tools.
   * All tools (bashkit + extra) get context layers applied.
   */
  extraTools?: ToolSet;
  /**
   * Custom context layers applied to all tools.
   * Runs after built-in layers (execution policy, output policy).
   */
  layers?: ContextLayer[];
}

export type AgentConfig = {
  tools?: {
    Bash?: ToolConfig;
    Read?: ToolConfig;
    Write?: ToolConfig;
    Edit?: ToolConfig;
    Glob?: ToolConfig;
    Grep?: GrepToolConfig;
  };
  /** Include AskUser tool for user clarification */
  askUser?: true | AskUserConfig;
  /** Include Patch tool for multi-hunk / multi-file apply-patch edits */
  patch?: true | ToolConfig;
  /** Include EnterPlanMode and ExitPlanMode tools for interactive planning */
  planMode?: boolean;
  /** Include Skill tool with this config */
  skill?: SkillConfig;
  /** Include WebSearch tool with this config */
  webSearch?: WebSearchConfig;
  /** Include WebFetch tool with this config */
  webFetch?: WebFetchConfig;
  /** Enable tool result caching */
  cache?: CacheConfig;
  /** Fetch model info (pricing + context lengths) from a provider.
   *  Used by budget tracking and compaction. */
  modelRegistry?: ModelRegistryConfig;
  /** Budget tracking configuration */
  budget?: BudgetConfig;
  /**
   * Context layer config. Opt-in — if not provided, tools work as they do today.
   * When provided, wraps all tools (bashkit + extraTools) with execution and output policies.
   */
  context?: ContextConfig;
  defaultTimeout?: number;
  workingDirectory?: string;
};

export const DEFAULT_CONFIG: AgentConfig = {
  defaultTimeout: 120000,
  workingDirectory: "/tmp",
  tools: {
    Bash: { maxOutputLength: 30000 },
  },
};
