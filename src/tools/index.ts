import type { ToolSet } from "ai";
import type { Sandbox } from "../sandbox/interface";
import type { AgentConfig } from "../types";
import { DEFAULT_CONFIG } from "../types";
import { createBashTool } from "./bash";
import { createReadTool } from "./read";
import { createWriteTool } from "./write";
import { createEditTool } from "./edit";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";

/**
 * Creates all sandbox-based agent tools for AI SDK's generateText/streamText.
 * Returns an object with Bash, Read, Write, Edit, Glob, Grep tools.
 *
 * @param sandbox - The sandbox to execute commands in
 * @param config - Optional configuration for individual tools
 */
export function createAgentTools(
  sandbox: Sandbox,
  config?: AgentConfig
): ToolSet {
  const toolsConfig = {
    ...DEFAULT_CONFIG.tools,
    ...config?.tools,
  };

  return {
    Bash: createBashTool(sandbox, toolsConfig.Bash),
    Read: createReadTool(sandbox, toolsConfig.Read),
    Write: createWriteTool(sandbox, toolsConfig.Write),
    Edit: createEditTool(sandbox, toolsConfig.Edit),
    Glob: createGlobTool(sandbox, toolsConfig.Glob),
    Grep: createGrepTool(sandbox, toolsConfig.Grep),
  };
}

// Sandbox-based tool factories (for custom configurations)
export { createBashTool } from "./bash";
export { createReadTool } from "./read";
export { createWriteTool } from "./write";
export { createEditTool } from "./edit";
export { createGlobTool } from "./glob";
export { createGrepTool } from "./grep";

// State/workflow tool factories (not sandbox-based)
export { createTodoWriteTool } from "./todo-write";
export { createExitPlanModeTool } from "./exit-plan-mode";
export { createTaskTool } from "./task";

// Web tool factories (require parallel-web peer dependency)
export { createWebSearchTool } from "./web-search";
export { createWebFetchTool } from "./web-fetch";

// Sandbox tool output types
export type { BashOutput, BashError } from "./bash";
export type {
  ReadOutput,
  ReadTextOutput,
  ReadDirectoryOutput,
  ReadError,
} from "./read";
export type { WriteOutput, WriteError } from "./write";
export type { EditOutput, EditError } from "./edit";
export type { GlobOutput, GlobError } from "./glob";
export type {
  GrepOutput,
  GrepContentOutput,
  GrepFilesOutput,
  GrepCountOutput,
  GrepMatch,
  GrepError,
} from "./grep";

// State/workflow tool types
export type {
  TodoItem,
  TodoState,
  TodoWriteOutput,
  TodoWriteError,
} from "./todo-write";
export type { ExitPlanModeOutput, ExitPlanModeError } from "./exit-plan-mode";
export type {
  TaskOutput,
  TaskError,
  TaskToolConfig,
  SubagentTypeConfig,
  SubagentStepEvent,
} from "./task";

// Web tool types
export type {
  WebSearchOutput,
  WebSearchResult,
  WebSearchError,
  WebSearchToolConfig,
} from "./web-search";
export type {
  WebFetchOutput,
  WebFetchError,
  WebFetchToolConfig,
} from "./web-fetch";
