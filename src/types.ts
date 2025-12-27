import type { LanguageModel, Tool } from "ai";
import type { SkillMetadata } from "./skills/types";

/**
 * SDK tool options picked from the Tool type.
 * This automatically adapts to the user's installed AI SDK version.
 * - v5 users get v5 options (if any)
 * - v6 users get v6 options (needsApproval, strict, etc.)
 */
export type SDKToolOptions = Partial<
  Pick<Tool<unknown, unknown>, "strict" | "needsApproval" | "providerOptions">
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
  allowedPaths?: string[];
  blockedCommands?: string[];
} & SDKToolOptions;

export type GrepToolConfig = ToolConfig & {
  /** Use ripgrep (rg) instead of grep. Requires ripgrep to be installed. Default: false */
  useRipgrep?: boolean;
};

export type WebSearchConfig = {
  apiKey: string;
} & SDKToolOptions;

export type WebFetchConfig = {
  apiKey: string;
  model: LanguageModel;
} & SDKToolOptions;

export type AskUserConfig = {
  /** Callback to handle questions and return answers */
  onQuestion?: (question: string) => Promise<string> | string;
};

export type SkillConfig = {
  /** Map of skill name to metadata */
  skills: Record<string, SkillMetadata>;
  /** Callback when a skill is activated */
  onActivate?: (
    skill: SkillMetadata,
    instructions: string,
  ) => void | Promise<void>;
};

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
  askUser?: AskUserConfig;
  /** Include EnterPlanMode and ExitPlanMode tools for interactive planning */
  planMode?: boolean;
  /** Include Skill tool with this config */
  skill?: SkillConfig;
  /** Include WebSearch tool with this config */
  webSearch?: WebSearchConfig;
  /** Include WebFetch tool with this config */
  webFetch?: WebFetchConfig;
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
