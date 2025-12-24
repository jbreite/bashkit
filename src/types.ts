import type { LanguageModel } from "ai";
import type { SkillMetadata } from "./skills/types";

export type ToolConfig = {
  timeout?: number;
  maxFileSize?: number;
  maxOutputLength?: number;
  allowedPaths?: string[];
  blockedCommands?: string[];
};

export type WebSearchConfig = {
  apiKey: string;
};

export type WebFetchConfig = {
  apiKey: string;
  model: LanguageModel;
};

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
    Grep?: ToolConfig;
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
