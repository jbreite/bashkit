export type ToolConfig = {
  enabled?: boolean;
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
    Bash: { enabled: true, maxOutputLength: 30000 },
    Read: { enabled: true },
    Write: { enabled: true },
    Edit: { enabled: true },
    Glob: { enabled: true },
    Grep: { enabled: true },
  },
};
