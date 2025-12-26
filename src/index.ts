// Main exports

// Re-export UIMessageStreamWriter from AI SDK for convenience
export type { UIMessageStreamWriter } from "ai";

// Middleware
export { anthropicPromptCacheMiddleware } from "./middleware";
export type {
  E2BSandboxConfig,
  LocalSandboxConfig,
  VercelSandboxConfig,
} from "./sandbox";
// Sandbox factories
export {
  createE2BSandbox,
  createLocalSandbox,
  createVercelSandbox,
} from "./sandbox";

// Sandbox interface
export type { ExecOptions, ExecResult, Sandbox } from "./sandbox/interface";
// Tool output types
export type {
  // Result type from createAgentTools
  AgentToolsResult,
  // AskUser tool
  AskUserError,
  AskUserOutput,
  AskUserResponseHandler,
  // Sandbox tools
  BashError,
  BashOutput,
  EditError,
  EditOutput,
  // Plan mode tools
  EnterPlanModeError,
  EnterPlanModeOutput,
  ExitPlanModeError,
  ExitPlanModeOutput,
  PlanModeState,
  GlobError,
  GlobOutput,
  GrepContentOutput,
  GrepCountOutput,
  GrepError,
  GrepFilesOutput,
  GrepMatch,
  GrepOutput,
  ReadDirectoryOutput,
  ReadError,
  ReadOutput,
  ReadTextOutput,
  // Skill tool
  SkillError,
  SkillOutput,
  SkillToolConfig,
  // Task tool
  SubagentEventData,
  SubagentStepEvent,
  SubagentTypeConfig,
  TaskError,
  TaskOutput,
  TaskToolConfig,
  // TodoWrite tool
  TodoItem,
  TodoState,
  TodoWriteError,
  TodoWriteOutput,
  // Web tools
  WebFetchError,
  WebFetchOutput,
  WebFetchToolConfig,
  WebSearchError,
  WebSearchOutput,
  WebSearchResult,
  WebSearchToolConfig,
  WriteError,
  WriteOutput,
} from "./tools";
// Tool factories
export {
  createAgentTools,
  createAskUserTool,
  createBashTool,
  createEditTool,
  createEnterPlanModeTool,
  createExitPlanModeTool,
  createGlobTool,
  createGrepTool,
  createReadTool,
  createSkillTool,
  createTaskTool,
  createTodoWriteTool,
  createWebFetchTool,
  createWebSearchTool,
  createWriteTool,
} from "./tools";
// Configuration types
export type {
  AgentConfig,
  AskUserConfig,
  SkillConfig,
  ToolConfig,
  WebFetchConfig,
  WebSearchConfig,
} from "./types";
export { DEFAULT_CONFIG } from "./types";
export type {
  CompactConversationConfig,
  CompactConversationResult,
  CompactConversationState,
  ContextMetrics,
  ContextStatus,
  ContextStatusConfig,
  ContextStatusLevel,
  ModelContextLimit,
  PruneMessagesConfig,
} from "./utils";
// Utils
export {
  compactConversation,
  contextNeedsAttention,
  contextNeedsCompaction,
  createCompactConfig,
  estimateMessagesTokens,
  estimateMessageTokens,
  estimateTokens,
  getContextStatus,
  MODEL_CONTEXT_LIMITS,
  pruneMessagesByTokens,
} from "./utils";

// Skills (Agent Skills standard support)
export type {
  DiscoverSkillsOptions,
  SkillBundle,
  SkillMetadata,
} from "./skills";
export {
  discoverSkills,
  fetchSkill,
  fetchSkills,
  parseSkillMetadata,
  skillsToXml,
} from "./skills";

// Setup (Agent environment setup for sandboxes)
export type {
  AgentEnvironmentConfig,
  SetupResult,
  SkillContent,
} from "./setup";
export { setupAgentEnvironment } from "./setup";
