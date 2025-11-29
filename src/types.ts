import type { LanguageModel } from "ai";

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

export type AgentConfig = {
  tools?: {
    Bash?: ToolConfig;
    Read?: ToolConfig;
    Write?: ToolConfig;
    Edit?: ToolConfig;
    Glob?: ToolConfig;
    Grep?: ToolConfig;
  };
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
