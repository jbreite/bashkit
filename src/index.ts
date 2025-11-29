// Main exports
export { createAgentTools } from "./tools";

// Sandbox factories
export {
  createLocalSandbox,
  createVercelSandbox,
  createE2BSandbox,
} from "./sandbox";
export type {
  LocalSandboxConfig,
  VercelSandboxConfig,
  E2BSandboxConfig,
} from "./sandbox";

// Sandbox interface
export type { Sandbox, ExecOptions, ExecResult } from "./sandbox/interface";

// Configuration types
export type {
  AgentConfig,
  ToolConfig,
  WebSearchConfig,
  WebFetchConfig,
} from "./types";
export { DEFAULT_CONFIG } from "./types";

// Sandbox-based tool factories
export {
  createBashTool,
  createReadTool,
  createWriteTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
} from "./tools";

// State/workflow tool factories
export {
  createTodoWriteTool,
  createExitPlanModeTool,
  createTaskTool,
} from "./tools";

// Web tool factories (require parallel-web peer dependency)
export { createWebSearchTool, createWebFetchTool } from "./tools";

// Sandbox tool output types
export type {
  BashOutput,
  BashError,
  ReadOutput,
  ReadTextOutput,
  ReadDirectoryOutput,
  ReadError,
  WriteOutput,
  WriteError,
  EditOutput,
  EditError,
  GlobOutput,
  GlobError,
  GrepOutput,
  GrepContentOutput,
  GrepFilesOutput,
  GrepCountOutput,
  GrepMatch,
  GrepError,
} from "./tools";

// Middleware
export { anthropicPromptCacheMiddleware } from "./middleware";

// Utils
export {
  pruneMessagesByTokens,
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
} from "./utils";
export type { PruneMessagesConfig } from "./utils";

// State/workflow tool types
export type {
  TodoItem,
  TodoState,
  TodoWriteOutput,
  TodoWriteError,
  ExitPlanModeOutput,
  ExitPlanModeError,
  TaskOutput,
  TaskError,
  TaskToolConfig,
  SubagentTypeConfig,
  SubagentStepEvent,
} from "./tools";

// Web tool types
export type {
  WebSearchOutput,
  WebSearchResult,
  WebSearchError,
  WebSearchToolConfig,
  WebFetchOutput,
  WebFetchError,
  WebFetchToolConfig,
} from "./tools";
