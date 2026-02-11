// Main exports

// Re-export commonly used AI SDK types for convenience
// This allows consumers to import everything from bashkit without
// needing to also import from "ai" for types used in return values
export type {
  UIMessageStreamWriter,
  StreamTextResult,
  Tool,
  ToolSet,
  LanguageModel,
  LanguageModelMiddleware,
  Output,
} from "ai";

// Middleware
export {
  anthropicPromptCacheMiddleware,
  anthropicPromptCacheMiddlewareV2,
} from "./middleware";
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
  ensureSandboxTools,
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
  QuestionOption,
  StructuredQuestion,
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
  WebSearchError,
  WebSearchOutput,
  WebSearchResult,
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
  CacheConfig,
  SkillConfig,
  ToolConfig,
  WebFetchConfig,
  WebSearchConfig,
} from "./types";
export { DEFAULT_CONFIG } from "./types";

// Cache utilities
export type {
  CachedTool,
  CacheEntry,
  CacheOptions,
  CacheStats,
  CacheStore,
  RedisCacheStoreOptions,
  RedisClient,
} from "./cache";
export { cached, createRedisCacheStore, LRUCacheStore } from "./cache";
export type {
  BudgetStatus,
  BudgetTracker,
  ModelPricing,
  CompactConversationConfig,
  CompactConversationResult,
  CompactConversationState,
  ContextMetrics,
  ContextStatus,
  ContextStatusConfig,
  ContextStatusLevel,
  DebugEvent,
  ModelContextLimit,
  PruneMessagesConfig,
} from "./utils";
// Utils
export {
  createBudgetTracker,
  clearDebugLogs,
  compactConversation,
  contextNeedsAttention,
  contextNeedsCompaction,
  createCompactConfig,
  estimateMessagesTokens,
  estimateMessageTokens,
  estimateTokens,
  getContextStatus,
  getDebugLogs,
  isDebugEnabled,
  MODEL_CONTEXT_LIMITS,
  pruneMessagesByTokens,
  reinitDebugMode,
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
  loadSkillBundle,
  loadSkillBundles,
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
