import type { ToolSet, Tool } from "ai";
import type { CacheStore } from "../cache/types";
import { cached, LRUCacheStore } from "../cache";
import { applyContextLayers, type ContextLayer } from "../context/index";
import { createExecutionPolicy } from "../context/execution-policy";
import { createOutputPolicy } from "../context/output-policy";
import { createRuntimeEventLayer } from "../context/runtime-events";
import type { Sandbox } from "../sandbox/interface";
import type { AgentConfig, CacheConfig } from "../types";
import { DEFAULT_CONFIG } from "../types";
import {
  createAiSdkSubagentRunner,
  createInMemorySubagentStore,
  createSubagentControlPanelState,
  createSubagentController,
  type SubagentController,
  type SubagentControlPanelState,
  type SubagentStore,
} from "../subagents";
import {
  createBudgetTracker,
  fetchOpenRouterModels,
  type BudgetTracker,
  type ModelInfo,
  type ModelPricing,
} from "../utils/budget-tracking";
import { createAskUserTool } from "./ask-user";
import { createBashTool } from "./bash";
import { createCodemodeTool } from "./codemode";
import { createEditTool } from "./edit";
import { createEnterPlanModeTool, type PlanModeState } from "./enter-plan-mode";
import { createExitPlanModeTool } from "./exit-plan-mode";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createPatchTool } from "./patch";
import { createReadTool } from "./read";
import { createSkillTool } from "./skill";
import { createPlanState, type PlanState } from "../runtime";
import { createSubagentControlTools } from "./subagents";
import { createUpdatePlanTool } from "./update-plan";
import { createWebFetchTool } from "./web-fetch";
import { createWebSearchTool } from "./web-search";
import { createWriteTool } from "./write";

/** Tools that are cached by default when cache: true */
const DEFAULT_CACHEABLE = [
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
] as const;

/**
 * Resolves cache configuration into store, ttl, debug flag, callbacks, and enabled tools.
 */
function resolveCache(config?: CacheConfig): {
  store: CacheStore | null;
  ttl: number;
  debug: boolean;
  onHit?: (toolName: string, key: string) => void;
  onMiss?: (toolName: string, key: string) => void;
  keyGenerator?: (toolName: string, params: unknown) => string;
  enabled: Set<string>;
} {
  if (!config) {
    return { store: null, ttl: 0, debug: false, enabled: new Set() };
  }

  if (config === true) {
    return {
      store: new LRUCacheStore(),
      ttl: 5 * 60 * 1000,
      debug: false,
      enabled: new Set(DEFAULT_CACHEABLE),
    };
  }

  // Check if it's a CacheStore (has required methods as functions)
  if (
    typeof config === "object" &&
    typeof (config as CacheStore).get === "function" &&
    typeof (config as CacheStore).set === "function" &&
    typeof (config as CacheStore).delete === "function" &&
    typeof (config as CacheStore).clear === "function"
  ) {
    return {
      store: config as CacheStore,
      ttl: 5 * 60 * 1000,
      debug: false,
      enabled: new Set(DEFAULT_CACHEABLE),
    };
  }

  // Object config with per-tool settings
  const enabled = new Set<string>();

  // Start with defaults
  for (const tool of DEFAULT_CACHEABLE) {
    if ((config as Record<string, unknown>)[tool] !== false) {
      enabled.add(tool);
    }
  }

  // Add any explicitly enabled tools (including non-defaults like Bash)
  for (const [key, value] of Object.entries(config)) {
    if (
      ["store", "ttl", "debug", "onHit", "onMiss", "keyGenerator"].includes(key)
    )
      continue;
    if (value === true) enabled.add(key);
    if (value === false) enabled.delete(key);
  }

  type ConfigObj = {
    store?: CacheStore;
    ttl?: number;
    debug?: boolean;
    onHit?: (toolName: string, key: string) => void;
    onMiss?: (toolName: string, key: string) => void;
    keyGenerator?: (toolName: string, params: unknown) => string;
  };

  const cfg = config as ConfigObj;

  return {
    store: cfg.store ?? new LRUCacheStore(),
    ttl: cfg.ttl ?? 5 * 60 * 1000,
    debug: cfg.debug ?? false,
    onHit: cfg.onHit,
    onMiss: cfg.onMiss,
    keyGenerator: cfg.keyGenerator,
    enabled,
  };
}

/**
 * Result from createAgentTools including tools and optional shared state.
 */
export interface AgentToolsResult {
  /** All configured tools for use with generateText/streamText */
  tools: ToolSet;
  /** Shared plan mode state (only present when planMode is enabled) */
  planModeState?: PlanModeState;
  /** Canonical Codex-style task plan state, updated by the default UpdatePlan tool. */
  planState: PlanState;
  /** Budget tracker (only present when budget config is set) */
  budget?: BudgetTracker;
  /** Subagent controller (only present when subagents config is set) */
  subagentController?: SubagentController;
  /** Subagent store used by the controller (only present when subagents config is set) */
  subagentStore?: SubagentStore;
  /** Returns a serializable control-panel snapshot for host UIs. */
  getSubagentControlPanelState?: () => Promise<SubagentControlPanelState>;
  /** Model info from OpenRouter (only present when modelRegistry or budget pricingProvider is configured) */
  openRouterModels?: Map<string, ModelInfo>;
  /** Context layers applied to tools. Use with applyContextLayers() for late-added tools. */
  contextLayers: ContextLayer[];
}

/**
 * Creates agent tools for AI SDK's generateText/streamText.
 *
 * **Default tools (always included):**
 * - Bash, Read, Write, Edit, Glob, Grep (sandbox operations)
 *
 * **Optional tools (via config):**
 * - `askUser` — AskUser tool for clarifying questions
 * - `patch` — Patch tool for multi-hunk / multi-file apply-patch edits
 * - `planMode` — EnterPlanMode, ExitPlanMode for interactive planning
 * - `skill` — Skill tool for skill execution
 * - `webSearch` — WebSearch tool
 * - `webFetch` — WebFetch tool
 *
 * @param sandbox - The sandbox to execute commands in
 * @param config - Optional configuration for tools
 * @returns Object with tools and optional planModeState
 *
 * @example
 * // Basic usage (lean default for background agents)
 * const { tools } = await createAgentTools(sandbox);
 *
 * @example
 * // Interactive agent with plan mode
 * const { tools, planModeState } = await createAgentTools(sandbox, {
 *   planMode: true,
 *   askUser: true,
 * });
 *
 * @example
 * // With budget tracking (OpenRouter pricing)
 * const { tools, budget } = await createAgentTools(sandbox, {
 *   budget: { maxUsd: 5.00, pricingProvider: "openRouter" },
 * });
 */
export async function createAgentTools(
  sandbox: Sandbox,
  config?: AgentConfig,
): Promise<AgentToolsResult> {
  const toolsConfig = {
    ...DEFAULT_CONFIG.tools,
    ...config?.tools,
  };

  const planModeState: PlanModeState | undefined = config?.planMode
    ? { isActive: false }
    : undefined;
  const planState = createPlanState(config?.runtime?.initialPlan);

  // Fetch model info from provider before budget so both can share the data.
  let openRouterModels: Map<string, ModelInfo> | undefined;

  const shouldFetchOpenRouter =
    config?.modelRegistry?.provider === "openRouter" ||
    config?.budget?.pricingProvider === "openRouter";

  if (shouldFetchOpenRouter) {
    const apiKey = config?.modelRegistry?.apiKey ?? config?.budget?.apiKey;

    try {
      openRouterModels = await fetchOpenRouterModels(apiKey);
    } catch (err) {
      // Only fatal if budget needs it and has no modelPricing fallback
      if (config?.budget && !config.budget.modelPricing) {
        throw new Error(
          `[bashkit] Failed to fetch OpenRouter pricing and no modelPricing overrides provided. ` +
            `Either provide modelPricing in your budget config or ensure network access to OpenRouter. ` +
            `Original error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Derive pricing-only map from models map for budget tracker
  let openRouterPricing: Map<string, ModelPricing> | undefined;
  if (openRouterModels) {
    openRouterPricing = new Map(
      [...openRouterModels].map(([k, v]) => [k, v.pricing]),
    );
  }

  // Create budget tracker if configured
  let budget: BudgetTracker | undefined;
  if (config?.budget) {
    const { modelPricing, maxUsd } = config.budget;

    // Validate: at least one pricing source required
    // modelRegistry, pricingProvider, or modelPricing
    if (!openRouterPricing && !modelPricing) {
      throw new Error(
        "[bashkit] Budget requires either modelRegistry, pricingProvider, or modelPricing.",
      );
    }

    budget = createBudgetTracker(maxUsd, {
      modelPricing,
      openRouterPricing,
    });
  }

  const runtimeTools: ToolSet = {
    // Core sandbox tools
    Bash: createBashTool(sandbox, toolsConfig.Bash),
    Read: createReadTool(sandbox, toolsConfig.Read),
    Write: createWriteTool(sandbox, toolsConfig.Write),
    Edit: createEditTool(sandbox, toolsConfig.Edit),
    Glob: createGlobTool(sandbox, toolsConfig.Glob),
    Grep: createGrepTool(sandbox, toolsConfig.Grep),
    UpdatePlan: createUpdatePlanTool(planState, {
      eventSink: config?.runtime?.eventSink,
      context: config?.runtime?.planContext,
      planModeState,
    }),
  };

  // Add AskUser tool if configured
  if (config?.askUser) {
    runtimeTools.AskUser = createAskUserTool(
      config.askUser === true ? undefined : config.askUser,
    );
  }

  // Add Patch tool if configured
  if (config?.patch) {
    runtimeTools.Patch = createPatchTool(
      sandbox,
      config.patch === true ? undefined : config.patch,
    );
  }

  // Add plan mode tools if configured
  if (planModeState) {
    runtimeTools.EnterPlanMode = createEnterPlanModeTool(planModeState);
    runtimeTools.ExitPlanMode = createExitPlanModeTool();
  }

  // Add Skill tool if configured
  if (config?.skill) {
    runtimeTools.Skill = createSkillTool({
      skills: config.skill.skills,
      sandbox,
      onActivate: config.skill.onActivate,
    });
  }

  // Add web tools if configured
  if (config?.webSearch) {
    runtimeTools.WebSearch = createWebSearchTool(config.webSearch);
  }
  if (config?.webFetch) {
    runtimeTools.WebFetch = createWebFetchTool(config.webFetch);
  }

  // Merge extra tools from context config
  if (config?.context?.extraTools) {
    for (const [name, extraTool] of Object.entries(config.context.extraTools)) {
      (runtimeTools as Record<string, Tool>)[name] = extraTool;
    }
  }

  // Apply caching if configured (inner wrapper — cache sits inside context)
  const cacheConfig = resolveCache(config?.cache);
  if (cacheConfig.store) {
    for (const [name, tool] of Object.entries(runtimeTools)) {
      if (cacheConfig.enabled.has(name)) {
        // Type assertion needed because cached() adds methods that ToolSet allows
        (runtimeTools as Record<string, unknown>)[name] = cached(tool, name, {
          store: cacheConfig.store,
          ttl: cacheConfig.ttl,
          debug: cacheConfig.debug,
          onHit: cacheConfig.onHit,
          onMiss: cacheConfig.onMiss,
          keyGenerator: cacheConfig.keyGenerator,
        });
      }
    }
  }

  // Build and apply context layers (outer wrapper — wraps outside cache)
  const contextLayers: ContextLayer[] = [];

  if (config?.context) {
    // Execution policy (plan-mode gating and/or custom shouldBlock)
    if (planModeState || config.context.executionPolicy?.shouldBlock) {
      contextLayers.push(
        createExecutionPolicy(planModeState, config.context.executionPolicy),
      );
    }

    // Output policy (enabled by default, unless explicitly false)
    if (config.context.outputPolicy !== false) {
      contextLayers.push(
        createOutputPolicy(
          config.context.outputPolicy === undefined
            ? undefined
            : config.context.outputPolicy,
        ),
      );
    }

    // Custom layers (run after built-in layers)
    if (config.context.layers) {
      contextLayers.push(...config.context.layers);
    }
  }

  if (config?.runtime?.eventSink) {
    contextLayers.push(
      createRuntimeEventLayer({
        eventSink: config.runtime.eventSink,
        agentId: config.runtime.planContext?.agent_id,
        threadId: config.runtime.planContext?.thread_id,
        turnId: config.runtime.planContext?.turn_id,
      }),
    );
  }

  // Apply all layers to all tools
  if (contextLayers.length > 0) {
    const wrapped = applyContextLayers(runtimeTools, contextLayers);
    for (const [name, wrappedTool] of Object.entries(wrapped)) {
      (runtimeTools as Record<string, Tool>)[name] = wrappedTool;
    }
  }

  const tools: ToolSet = config?.codemode ? {} : { ...runtimeTools };
  if (config?.codemode) {
    tools.UpdatePlan = runtimeTools.UpdatePlan;
    if (runtimeTools.AskUser) tools.AskUser = runtimeTools.AskUser;
    if (runtimeTools.EnterPlanMode)
      tools.EnterPlanMode = runtimeTools.EnterPlanMode;
    if (runtimeTools.ExitPlanMode)
      tools.ExitPlanMode = runtimeTools.ExitPlanMode;
    if (runtimeTools.Skill) tools.Skill = runtimeTools.Skill;
  }
  let subagentStore: SubagentStore | undefined;
  let subagentController: SubagentController | undefined;
  let subagentRunnerCapabilities:
    | ReturnType<typeof createAiSdkSubagentRunner>["capabilities"]
    | undefined;

  // Add Cloudflare Codemode tool after cache/context wrapping so generated code
  // orchestrates the same policy-wrapped tools a model would call directly.
  if (config?.codemode) {
    const codemodeOnlyTools =
      config.codemode.tools && contextLayers.length > 0
        ? applyContextLayers(config.codemode.tools, contextLayers)
        : (config.codemode.tools ?? {});
    const codemodeProviders = config.codemode.providers?.map((provider) => ({
      ...provider,
      tools:
        contextLayers.length > 0
          ? applyContextLayers(provider.tools, contextLayers)
          : provider.tools,
    }));
    const codemodeConfig = {
      ...config.codemode,
      tools: codemodeOnlyTools,
      providers: codemodeProviders,
    };

    const { name, tool: rawCodemodeTool } = await createCodemodeTool(
      runtimeTools,
      codemodeConfig,
    );

    if (tools[name] || runtimeTools[name]) {
      throw new Error(
        `[bashkit] Codemode tool name "${name}" conflicts with an existing tool.`,
      );
    }

    const codemodeTool =
      contextLayers.length > 0
        ? applyContextLayers({ [name]: rawCodemodeTool }, contextLayers)[name]
        : rawCodemodeTool;

    tools[name] = codemodeTool;
  }

  if (config?.subagents) {
    subagentStore = config.subagents.store ?? createInMemorySubagentStore();
    const runner =
      config.subagents.runner ??
      createAiSdkSubagentRunner({
        ...config.subagents.runnerConfig,
        model: config.subagents.model,
        codemode: config.codemode,
      });
    subagentRunnerCapabilities = runner.capabilities;
    subagentController = createSubagentController({
      profiles: config.subagents.profiles,
      defaultProfile: config.subagents.defaultProfile,
      profileDefaults: config.subagents.profileDefaults,
      store: subagentStore,
      runner,
      tools: runtimeTools,
      eventSink: config.subagents.eventSink,
      runtimeEventSink: config.runtime?.eventSink,
      lifecycle: config.subagents.lifecycle,
      budget,
      cost: config.subagents.cost,
    });
    const subagentControlTools = createSubagentControlTools(
      subagentController,
      config.subagents.controlTools,
    );
    Object.assign(
      tools,
      contextLayers.length > 0
        ? applyContextLayers(subagentControlTools, contextLayers)
        : subagentControlTools,
    );
  }

  return {
    tools,
    planModeState,
    planState,
    budget,
    subagentController,
    subagentStore,
    getSubagentControlPanelState:
      subagentStore && subagentController
        ? async () =>
            createSubagentControlPanelState({
              records: await subagentStore.list(),
              capabilities: subagentRunnerCapabilities,
              budget: budget?.getStatus(),
            })
        : undefined,
    openRouterModels,
    contextLayers,
  };
}

// --- Ask User Tool ---
export type {
  AskUserAnswers,
  AskUserInput,
  AskUserOutput,
  AskUserQuestion,
  AskUserQuestionOption,
  AskUserToolConfig,
} from "./ask-user";
export { createAskUserTool } from "./ask-user";

// --- Sandbox tool output types ---
export type { BashError, BashOutput } from "./bash";
// Sandbox-based tool factories (for custom configurations)
export { createBashTool } from "./bash";
export type {
  CodemodeConfig,
  CodemodeConnectorBinding,
  CodemodeExecuteOptions,
  CodemodeExecuteResult,
  CodemodeExecutor,
  CodemodeResolvedProvider,
  CodemodeToolProvider,
  CodemodeToolExclusionReason,
  CreateCodeTool,
} from "./codemode";
export { createCodemodeTool, selectCodemodeTools } from "./codemode";
export type { EditError, EditOutput } from "./edit";
export { createEditTool } from "./edit";
// --- Plan Mode Tools ---
export type {
  EnterPlanModeError,
  EnterPlanModeOutput,
  PlanModeState,
} from "./enter-plan-mode";
export { createEnterPlanModeTool } from "./enter-plan-mode";
export type { ExitPlanModeError, ExitPlanModeOutput } from "./exit-plan-mode";
export { createExitPlanModeTool } from "./exit-plan-mode";
export type { GlobError, GlobOutput } from "./glob";
export { createGlobTool } from "./glob";
export type { PatchError, PatchFileResult, PatchOutput } from "./patch";
export { createPatchTool } from "./patch";

export type {
  GrepContentOutput,
  GrepCountOutput,
  GrepError,
  GrepFilesOutput,
  GrepMatch,
  GrepOutput,
} from "./grep";
export { createGrepTool } from "./grep";
export type {
  ReadDirectoryOutput,
  ReadError,
  ReadOutput,
  ReadTextOutput,
} from "./read";
export { createReadTool } from "./read";

// --- Skill Tool ---
export type { SkillError, SkillOutput, SkillToolConfig } from "./skill";
export { createSkillTool } from "./skill";

// --- Subagent Control Tools ---
export type {
  CompactSubagentRecord,
  InterruptAgentOutput,
  ListAgentsOutput,
  MessageAgentOutput,
  SpawnAgentOutput,
  SubagentControlToolConfig,
  SubagentToolError,
  WaitAgentOutput,
} from "./subagents";
export {
  createFollowupTaskTool,
  createInterruptAgentTool,
  createListAgentsTool,
  createSendMessageTool,
  createSpawnAgentTool,
  createSubagentControlTools,
  createWaitAgentTool,
} from "./subagents";
// --- UpdatePlan Tool ---
export type {
  UpdatePlanError,
  UpdatePlanOutput,
  UpdatePlanToolConfig,
} from "./update-plan";
export { createUpdatePlanTool } from "./update-plan";
export type { ExtractResult, WebFetchError, WebFetchOutput } from "./web-fetch";
export { createWebFetchTool } from "./web-fetch";
// Web tool types
export type {
  WebSearchError,
  WebSearchOutput,
  WebSearchResult,
} from "./web-search";
// Web tool factories (require parallel-web peer dependency)
export { createWebSearchTool } from "./web-search";
export type { WriteError, WriteOutput } from "./write";
export { createWriteTool } from "./write";
