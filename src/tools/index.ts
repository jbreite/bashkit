import type { ToolSet } from "ai";
import type { CacheStore } from "../cache/types";
import { cached, LRUCacheStore } from "../cache";
import type { Sandbox } from "../sandbox/interface";
import type { AgentConfig, CacheConfig } from "../types";
import { DEFAULT_CONFIG } from "../types";
import { createAskUserTool } from "./ask-user";
import { createBashTool } from "./bash";
import { createEditTool } from "./edit";
import { createEnterPlanModeTool, type PlanModeState } from "./enter-plan-mode";
import { createExitPlanModeTool } from "./exit-plan-mode";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createReadTool } from "./read";
import { createSkillTool } from "./skill";
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
}

/**
 * Creates agent tools for AI SDK's generateText/streamText.
 *
 * **Default tools (always included):**
 * - Bash, Read, Write, Edit, Glob, Grep (sandbox operations)
 *
 * **Optional tools (via config):**
 * - `askUser` — AskUser tool for clarifying questions
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
 * const { tools } = createAgentTools(sandbox);
 *
 * @example
 * // Interactive agent with plan mode
 * const { tools, planModeState } = createAgentTools(sandbox, {
 *   planMode: true,
 *   askUser: { onQuestion: async (q) => await promptUser(q) },
 * });
 *
 * @example
 * // With web and skill tools
 * const { tools } = createAgentTools(sandbox, {
 *   webSearch: { apiKey: process.env.PARALLEL_API_KEY },
 *   skill: { skills: discoveredSkills },
 * });
 */
export function createAgentTools(
  sandbox: Sandbox,
  config?: AgentConfig,
): AgentToolsResult {
  const toolsConfig = {
    ...DEFAULT_CONFIG.tools,
    ...config?.tools,
  };

  const tools: ToolSet = {
    // Core sandbox tools (always included)
    Bash: createBashTool(sandbox, toolsConfig.Bash),
    Read: createReadTool(sandbox, toolsConfig.Read),
    Write: createWriteTool(sandbox, toolsConfig.Write),
    Edit: createEditTool(sandbox, toolsConfig.Edit),
    Glob: createGlobTool(sandbox, toolsConfig.Glob),
    Grep: createGrepTool(sandbox, toolsConfig.Grep),
  };

  let planModeState: PlanModeState | undefined;

  // Add AskUser tool if configured
  if (config?.askUser) {
    tools.AskUser = createAskUserTool(config.askUser.onQuestion);
  }

  // Add plan mode tools if configured
  if (config?.planMode) {
    planModeState = { isActive: false };
    tools.EnterPlanMode = createEnterPlanModeTool(planModeState);
    tools.ExitPlanMode = createExitPlanModeTool();
  }

  // Add Skill tool if configured
  if (config?.skill) {
    tools.Skill = createSkillTool({
      skills: config.skill.skills,
      sandbox,
      onActivate: config.skill.onActivate,
    });
  }

  // Add web tools if configured
  if (config?.webSearch) {
    tools.WebSearch = createWebSearchTool(config.webSearch);
  }
  if (config?.webFetch) {
    tools.WebFetch = createWebFetchTool(config.webFetch);
  }

  // Apply caching if configured
  const cacheConfig = resolveCache(config?.cache);
  if (cacheConfig.store) {
    for (const [name, tool] of Object.entries(tools)) {
      if (cacheConfig.enabled.has(name)) {
        // Type assertion needed because cached() adds methods that ToolSet allows
        (tools as Record<string, unknown>)[name] = cached(tool, name, {
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

  return { tools, planModeState };
}

// --- Ask User Tool ---
export type {
  AskUserError,
  AskUserOutput,
  AskUserResponseHandler,
  QuestionOption,
  StructuredQuestion,
} from "./ask-user";
export { createAskUserTool } from "./ask-user";

// --- Sandbox tool output types ---
export type { BashError, BashOutput } from "./bash";
// Sandbox-based tool factories (for custom configurations)
export { createBashTool } from "./bash";
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

// --- Task Tool ---
export type {
  SubagentEventData,
  SubagentStepEvent,
  SubagentTypeConfig,
  TaskError,
  TaskOutput,
  TaskToolConfig,
} from "./task";
export { createTaskTool } from "./task";
// State/workflow tool types
export type {
  TodoItem,
  TodoState,
  TodoWriteError,
  TodoWriteOutput,
} from "./todo-write";
// State/workflow tool factories (not sandbox-based)
export { createTodoWriteTool } from "./todo-write";
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
