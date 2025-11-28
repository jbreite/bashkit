export type ToolConfig = {
  timeout?: number;
  maxFileSize?: number;
  maxOutputLength?: number;
  allowedPaths?: string[];
  blockedCommands?: string[];
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
