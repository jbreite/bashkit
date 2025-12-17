import type { ToolSet } from "ai";
import type { Sandbox } from "../sandbox/interface";
import type { AgentConfig } from "../types";
import { DEFAULT_CONFIG } from "../types";
import { createBashTool } from "./bash";
import { createEditTool } from "./edit";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createReadTool } from "./read";
import { createWebFetchTool } from "./web-fetch";
import { createWebSearchTool } from "./web-search";
import { createWriteTool } from "./write";

/**
 * Creates all sandbox-based agent tools for AI SDK's generateText/streamText.
 * Returns an object with Bash, Read, Write, Edit, Glob, Grep tools.
 * Optionally includes WebSearch and WebFetch if configured.
 *
 * @param sandbox - The sandbox to execute commands in
 * @param config - Optional configuration for individual tools and web tools
 *
 * @example
 * // Basic sandbox tools only
 * const tools = createAgentTools(sandbox);
 *
 * @example
 * // With web tools included
 * const tools = createAgentTools(sandbox, {
 *   webSearch: { apiKey: process.env.PARALLEL_API_KEY },
 *   webFetch: { apiKey: process.env.PARALLEL_API_KEY, model: haiku },
 * });
 */
export function createAgentTools(
  sandbox: Sandbox,
  config?: AgentConfig,
): ToolSet {
  const toolsConfig = {
    ...DEFAULT_CONFIG.tools,
    ...config?.tools,
  };

  const tools: ToolSet = {
    Bash: createBashTool(sandbox, toolsConfig.Bash),
    Read: createReadTool(sandbox, toolsConfig.Read),
    Write: createWriteTool(sandbox, toolsConfig.Write),
    Edit: createEditTool(sandbox, toolsConfig.Edit),
    Glob: createGlobTool(sandbox, toolsConfig.Glob),
    Grep: createGrepTool(sandbox, toolsConfig.Grep),
  };

  // Add web tools if configured
  if (config?.webSearch) {
    tools.WebSearch = createWebSearchTool(config.webSearch);
  }
  if (config?.webFetch) {
    tools.WebFetch = createWebFetchTool(config.webFetch);
  }

  return tools;
}

// Sandbox tool output types
export type { BashError, BashOutput } from "./bash";
// Sandbox-based tool factories (for custom configurations)
export { createBashTool } from "./bash";
export type { EditError, EditOutput } from "./edit";
export { createEditTool } from "./edit";
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
export type {
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
export type {
  WebFetchError,
  WebFetchOutput,
  WebFetchToolConfig,
} from "./web-fetch";
export { createWebFetchTool } from "./web-fetch";
// Web tool types
export type {
  WebSearchError,
  WebSearchOutput,
  WebSearchResult,
  WebSearchToolConfig,
} from "./web-search";
// Web tool factories (require parallel-web peer dependency)
export { createWebSearchTool } from "./web-search";
export type { WriteError, WriteOutput } from "./write";
export { createWriteTool } from "./write";
