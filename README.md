# bashkit

Agentic coding tools for Vercel AI SDK. Give Claude the ability to execute code, read/write files, and perform coding tasks in a sandboxed environment.

## Overview

`bashkit` provides a set of tools that work with the Vercel AI SDK to enable agentic coding capabilities. Inspired by Claude Code, it gives AI models like Claude the ability to:

- Execute bash commands
- Read and view files
- Create new files
- Edit existing files with string replacement

## Installation

```bash
bun add @yourusername/bashkit ai zod
```

## Quick Start

```typescript
import { createAgentTools, VercelSandbox } from '@yourusername/bashkit';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

// Create a sandbox
const sandbox = new VercelSandbox();

// Create tools bound to the sandbox
const tools = createAgentTools(sandbox);

// Use with Vercel AI SDK
const result = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  tools,
  maxSteps: 10,
  prompt: 'Create a simple Express server in server.js'
});

console.log(result.text);

// Cleanup
await sandbox.destroy();
```

## Usage in Next.js API Route

```typescript
// app/api/agent/route.ts
import { createAgentTools, VercelSandbox } from '@yourusername/bashkit';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';

export async function POST(req: Request) {
  const { messages } = await req.json();
  
  const sandbox = new VercelSandbox();
  const tools = createAgentTools(sandbox);
  
  const result = streamText({
    model: anthropic('claude-sonnet-4-5'),
    messages,
    tools,
    maxSteps: 10,
  });
  
  return result.toDataStreamResponse();
}
```

## Available Tools

### `bash`
Execute bash commands in the sandbox.

**Parameters:**
- `command` (string): Bash command to execute
- `description` (string): Why you're running this command
- `restart` (boolean, optional): Restart the shell before executing

**Example:**
```typescript
// Claude can call this tool like:
{
  tool: "bash",
  args: {
    command: "ls -la",
    description: "List files in current directory"
  }
}
```

### `view`
View files and directories.

**Parameters:**
- `path` (string): Absolute path to file or directory
- `description` (string): Why you need to view this
- `view_range` ([number, number], optional): Line range for text files [start, end]

### `create_file`
Create a new file with content.

**Parameters:**
- `path` (string): Path where file should be created
- `file_text` (string): Content to write to the file
- `description` (string): Why you're creating this file

### `str_replace`
Replace a unique string in a file.

**Parameters:**
- `path` (string): Path to file to edit
- `old_str` (string): String to replace (must appear exactly once)
- `new_str` (string): Replacement string (empty to delete)
- `description` (string): Why you're making this edit

## Configuration

You can configure tools with security restrictions and limits:

```typescript
const tools = createAgentTools(sandbox, {
  tools: {
    bash: {
      enabled: true,
      timeout: 30000,
      blockedCommands: ['rm -rf', 'curl'],
      maxOutputLength: 10000
    },
    view: {
      enabled: true,
      allowedPaths: ['/workspace/**']
    },
    create_file: {
      enabled: true,
      maxFileSize: 1_000_000 // 1MB limit
    },
    str_replace: {
      enabled: true
    }
  },
  defaultTimeout: 10000,
  workingDirectory: '/workspace'
});
```

### Configuration Options

#### Global Config
- `defaultTimeout` (number): Default timeout for all tools in milliseconds
- `workingDirectory` (string): Default working directory for the sandbox

#### Per-Tool Config
- `enabled` (boolean): Enable/disable the tool
- `timeout` (number): Tool-specific timeout
- `maxFileSize` (number): Maximum file size in bytes (create_file)
- `maxOutputLength` (number): Maximum output length (bash)
- `allowedPaths` (string[]): Restrict file operations to specific paths
- `blockedCommands` (string[]): Block commands containing these strings (bash)

## Sandbox Interface

`bashkit` uses a bring-your-own-sandbox architecture. The default `VercelSandbox` is included, but you can implement custom sandboxes:

```typescript
interface Sandbox {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  fileExists(path: string): Promise<boolean>;
  destroy(): Promise<void>;
}
```

### Custom Sandbox Example

```typescript
import { Sandbox } from '@yourusername/bashkit';

class DockerSandbox implements Sandbox {
  // Your implementation
  async exec(command: string) { /* ... */ }
  async readFile(path: string) { /* ... */ }
  // ... other methods
}

const sandbox = new DockerSandbox();
const tools = createAgentTools(sandbox);
```

## Architecture

```
┌─────────────────────────────────────┐
│   Your Next.js App / Script         │
│                                     │
│   ┌─────────────────────────────┐  │
│   │  Vercel AI SDK              │  │
│   │  (streamText/generateText)  │  │
│   └──────────┬──────────────────┘  │
│              │                      │
│   ┌──────────▼──────────────────┐  │
│   │  bashkit Tools              │  │
│   │  (bash, view, create, etc)  │  │
│   └──────────┬──────────────────┘  │
│              │                      │
│   ┌──────────▼──────────────────┐  │
│   │  Sandbox                    │  │
│   │  (VercelSandbox/Custom)     │  │
│   └─────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Flow:**
1. User sends prompt to AI via Vercel AI SDK
2. AI decides it needs to use a tool (e.g., create a file)
3. Tool receives the call and executes via the Sandbox
4. Result returns to AI, which continues or completes

## Design Principles

1. **Bring Your Own Sandbox**: Start with VercelSandbox, swap in Docker/E2B/Modal as needed
2. **Type-Safe**: Full TypeScript support with proper type inference
3. **Configurable**: Security controls and limits at the tool level
4. **Vercel AI SDK Native**: Uses standard `tool()` format
5. **Claude Code Compatible**: Tool signatures match Claude Code for prompt reusability

## Examples

See the `examples/` directory for complete working examples:

- `basic-agent/` - Simple Next.js app with agent route
- `custom-sandbox/` - Using a custom sandbox implementation

## API Reference

### `createAgentTools(sandbox, config?)`

Creates a set of agent tools bound to a sandbox instance.

**Parameters:**
- `sandbox` (Sandbox): Sandbox instance for code execution
- `config` (AgentConfig, optional): Configuration for tools and behavior

**Returns:** Object with tool definitions compatible with Vercel AI SDK

### `VercelSandbox`

Default sandbox implementation using Vercel's execution environment.

**Constructor:**
- `workingDirectory` (string, optional): Working directory for the sandbox

**Methods:**
- All methods from `Sandbox` interface

## Future Roadmap

The following features are planned for future releases:

### MCP (Model Context Protocol) Tools

Support for MCP resources to enable AI agents to access external data sources:

#### `ListMcpResources`
List all available MCP resources from connected servers.

**Returns:**
```typescript
{
  resources: Array<{
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
    server: string;
  }>;
  total: number;
}
```

#### `ReadMcpResource`
Read the contents of a specific MCP resource.

**Parameters:**
- `uri` (string): The resource URI to read

**Returns:**
```typescript
{
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
  server: string;
}
```

### Permission System

Fine-grained permission control for tool operations:

#### Permission Update Operations

```typescript
type PermissionUpdate =
  | {
      type: 'addRules';
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'replaceRules';
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'removeRules';
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'setMode';
      mode: PermissionMode;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'addDirectories';
      directories: string[];
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'removeDirectories';
      directories: string[];
      destination: PermissionUpdateDestination;
    };
```

#### Permission Behaviors
```typescript
type PermissionBehavior = 'allow' | 'deny' | 'ask';
```

#### Permission Destinations
```typescript
type PermissionUpdateDestination =
  | 'userSettings'     // Global user settings
  | 'projectSettings'  // Per-directory project settings
  | 'localSettings'    // Gitignored local settings
  | 'session';         // Current session only
```

#### Permission Rules
```typescript
type PermissionRuleValue = {
  toolName: string;
  ruleContent?: string;
}
```

**Usage Example:**
```typescript
const tools = createAgentTools(sandbox, {
  permissions: {
    rules: [
      { toolName: 'bash', ruleContent: 'rm -rf' }  // Block dangerous commands
    ],
    behavior: 'deny',
    destination: 'projectSettings'
  }
});
```

### Advanced Sandbox Configuration

Enhanced sandbox settings for security and network control:

```typescript
type SandboxSettings = {
  enabled?: boolean;
  autoAllowBashIfSandboxed?: boolean;
  excludedCommands?: string[];
  allowUnsandboxedCommands?: boolean;
  network?: NetworkSandboxSettings;
  ignoreViolations?: SandboxIgnoreViolations;
  enableWeakerNestedSandbox?: boolean;
}
```

#### Configuration Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable sandbox mode for command execution |
| `autoAllowBashIfSandboxed` | boolean | `false` | Auto-approve bash commands when sandbox is enabled |
| `excludedCommands` | string[] | `[]` | Commands that always bypass sandbox restrictions (e.g., `['docker']`). These run unsandboxed automatically without model involvement |
| `allowUnsandboxedCommands` | boolean | `false` | Allow the model to request running commands outside the sandbox. When true, the model can set `dangerouslyDisableSandbox` in tool input, which falls back to the permissions system |
| `network` | NetworkSandboxSettings | `undefined` | Network-specific sandbox configuration |
| `ignoreViolations` | SandboxIgnoreViolations | `undefined` | Configure which sandbox violations to ignore |
| `enableWeakerNestedSandbox` | boolean | `false` | Enable a weaker nested sandbox for compatibility |

**Usage Example:**
```typescript
const tools = createAgentTools(sandbox, {
  sandbox: {
    enabled: true,
    autoAllowBashIfSandboxed: true,
    excludedCommands: ['docker', 'kubectl'],
    allowUnsandboxedCommands: false,
    network: {
      allowedDomains: ['api.github.com', '*.npmjs.org'],
      blockedDomains: ['evil.com']
    }
  }
});
```

**Important Notes:**
- Filesystem read restrictions: Controlled by `Read` deny rules
- Filesystem write restrictions: Controlled by `Edit` allow/deny rules
- Network restrictions: Controlled by `WebFetch` allow/deny rules
- Use sandbox settings for command execution sandboxing
- Use permission rules for filesystem and network access control

## Contributing

Contributions welcome! Please open an issue or PR.

## License

MIT