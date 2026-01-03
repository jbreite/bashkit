# BashKit - Claude Code Guide

> Agentic coding tools for Vercel AI SDK

**Tech Stack**: TypeScript • Bun • Vercel AI SDK • Zod
**Inspired by**: Claude Code tools
**Version**: 0.1.0

---

## Project Overview

### What BashKit Solves

BashKit provides a comprehensive toolkit for building AI coding agents using the Vercel AI SDK. It bridges the gap between AI models like Claude and actual code execution environments, enabling agents to:

- Execute bash commands
- Read, write, and edit files
- Search codebases with glob/grep
- Fetch web content and perform searches
- Spawn sub-agents for complex tasks
- Manage state with todo lists

### Key Features

**10 Tools Available**:
- **Bash** - Execute shell commands with timeout control
- **Read** - Read files and list directories
- **Write** - Create or overwrite files
- **Edit** - Replace strings in existing files
- **Glob** - Find files by pattern matching
- **Grep** - Search file contents with regex
- **WebSearch** - Web search with domain filtering
- **WebFetch** - Fetch and analyze web URLs
- **Task** - Spawn sub-agents for complex work
- **TodoWrite** - Manage structured task lists

### Architecture Philosophy

1. **Bring Your Own Sandbox** - Start with LocalSandbox, swap to Vercel/E2B for production
2. **Type-Safe** - Full TypeScript with proper inference
3. **Configurable** - Security controls and limits at the tool level
4. **Composable** - Tools work together seamlessly
5. **Claude Code Compatible** - Tool signatures match Claude Code patterns

### Use Cases

- AI coding assistants and agents
- Automated development workflows
- Interactive code exploration tools
- Educational coding environments
- CI/CD automation with AI

---

## Architecture & Patterns

### Code Organization

```
src/
├── sandbox/         # Execution environment abstractions
│   ├── interface.ts # Core Sandbox interface (7 methods)
│   ├── local.ts     # Bun-based local development sandbox
│   ├── vercel.ts    # Vercel Firecracker VM sandbox
│   └── e2b.ts       # E2B code interpreter sandbox
├── tools/           # Tool implementations (10 tools)
│   ├── bash.ts      # Shell command execution
│   ├── read.ts      # File/directory reading
│   ├── write.ts     # File creation
│   ├── edit.ts      # String replacement editing
│   ├── glob.ts      # Pattern-based file finding
│   ├── grep.ts      # Regex content search
│   ├── web-search.ts    # Web search via parallel-web
│   ├── web-fetch.ts     # URL content fetching
│   ├── task.ts          # Sub-agent spawning
│   ├── todo-write.ts    # Task list management
│   └── index.ts         # Tool factory orchestration
├── cache/           # Tool result caching
│   ├── types.ts     # CacheStore interface & types
│   ├── lru.ts       # LRU cache implementation
│   ├── cached.ts    # cached() tool wrapper function
│   └── index.ts     # Barrel exports
├── middleware/      # Vercel AI SDK middleware
│   └── anthropic-cache.ts  # Prompt caching for Claude
├── utils/           # Utility functions
│   └── prune-messages.ts   # Token estimation and pruning
├── types.ts         # Configuration types
└── index.ts         # Main exports (barrel file)
```

**Total**: 27 TypeScript files

### Key Design Patterns

#### 1. Factory Pattern
All tools and sandboxes created via factory functions:
```typescript
const sandbox = createLocalSandbox({ workingDirectory: '/tmp' });
const { tools } = createAgentTools(sandbox, config);
```

#### 2. Sandbox Abstraction
Tools depend on the `Sandbox` interface, not specific implementations:
```typescript
interface Sandbox {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  fileExists(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  destroy(): Promise<void>;
}
```

#### 3. Tool Composition
Tools assembled into a ToolSet for Vercel AI SDK:
```typescript
const { tools } = createAgentTools(sandbox, {
  tools: { Bash: { timeout: 30000 } },
  webSearch: { apiKey: process.env.PARALLEL_API_KEY }
});
// Returns: { Bash, Read, Write, Edit, Glob, Grep, WebSearch }
```

#### 4. Middleware System
Language models wrapped for cross-cutting concerns:
```typescript
const model = wrapLanguageModel({
  model: anthropic('claude-sonnet-4-5'),
  middleware: anthropicPromptCacheMiddleware
});
```

#### 5. Configuration as Code
Zod schemas define and validate all tool inputs:
```typescript
const bashInputSchema = z.object({
  command: z.string(),
  description: z.string(),
  restart: z.boolean().optional()
});
```

#### 6. Tool Result Caching
Optional caching for tool execution results:
```typescript
// Enable with defaults (LRU, 5min TTL)
const { tools } = createAgentTools(sandbox, { cache: true });

// Per-tool control
const { tools } = createAgentTools(sandbox, {
  cache: { Read: true, Glob: true, Grep: false }
});

// Standalone wrapper
import { cached } from 'bashkit';
const cachedTool = cached(myTool, 'MyTool', { ttl: 60000 });
```

**Default cached tools**: Read, Glob, Grep, WebFetch, WebSearch
**Not cached by default**: Bash, Write, Edit (side effects)

### Component Interactions

```
User → Vercel AI SDK → Tool (Bash/Read/Write/etc.)
                          ↓
                       Sandbox Interface
                          ↓
            ┌─────────────┼─────────────┐
            ↓             ↓             ↓
       LocalSandbox  VercelSandbox  E2BSandbox
            ↓             ↓             ↓
         Bun API    Firecracker VM   E2B Service
```

---

## File Map (Quick Reference)

### By Task

**Adding/Modifying Tools**
- Tool implementations: `/src/tools/*.ts`
- Tool factory: `/src/tools/index.ts`
- Reference implementation: `/src/tools/bash.ts`

**Sandbox Work**
- Interface definition: `/src/sandbox/interface.ts`
- Local dev: `/src/sandbox/local.ts`
- Production: `/src/sandbox/vercel.ts` or `/src/sandbox/e2b.ts`

**Configuration**
- Type definitions: `/src/types.ts`
- Default config: `/src/types.ts` (DEFAULT_CONFIG)

**Middleware**
- Implementations: `/src/middleware/*.ts`
- Prompt caching: `/src/middleware/anthropic-cache.ts`

**Caching**
- Cache types: `/src/cache/types.ts`
- LRU implementation: `/src/cache/lru.ts`
- Tool wrapper: `/src/cache/cached.ts`
- Barrel exports: `/src/cache/index.ts`

**Utilities**
- Message handling: `/src/utils/prune-messages.ts`

**Entry Points**
- Main exports: `/src/index.ts`
- Package config: `/package.json`

**Examples & Testing**
- Full agent example: `/examples/basic.ts`
- Direct tool testing: `/examples/test-tools.ts`
- Web tools demo: `/examples/test-web-tools.ts`

---

## Development Workflow

### Build Commands

```bash
# IMPORTANT: Always run typecheck BEFORE build when making changes
bun run typecheck

# Build everything (JS bundle + TypeScript declarations)
bun run build

# Install dependencies
bun install
```

**Workflow**: Always run `bun run typecheck` first to catch type errors before building. The build command does not fail on type errors during the JS bundling step.

**Build Process**:
1. Bun bundles TypeScript to ESM JavaScript (`dist/index.js`)
2. TypeScript compiler generates `.d.ts` declarations
3. All dependencies marked as external (no bundling of `ai`, `zod`, etc.)

### Testing Changes

**No formal test suite** - use examples as integration tests:

```bash
# Test tools directly (no AI, no API key needed)
bun examples/test-tools.ts

# Test web tools (requires PARALLEL_API_KEY)
PARALLEL_API_KEY=xxx bun examples/test-web-tools.ts

# Full agentic loop (requires ANTHROPIC_API_KEY)
ANTHROPIC_API_KEY=xxx bun examples/basic.ts
```

### Local Development

```typescript
// Use LocalSandbox for fast iteration
import { createLocalSandbox, createAgentTools } from './src';

const sandbox = createLocalSandbox({ workingDirectory: '/tmp' });
const { tools } = createAgentTools(sandbox);

// Test your changes...
await tools.Bash.execute({
  command: 'echo "Hello"',
  description: 'Test command'
}, { toolCallId: 'test', messages: [] });
```

**Pro Tips**:
- LocalSandbox uses Bun APIs (fast, no network overhead)
- Use VercelSandbox or E2BSandbox for testing production behavior
- Check `examples/test-tools.ts` for tool API patterns

---

## Common Implementation Tasks

### Task 1: Adding a New Tool

**Step-by-step**:

1. **Create tool file**: `/src/tools/your-tool.ts`

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { zodSchema } from 'ai';
import type { Sandbox } from '../sandbox/interface';
import type { ToolConfig } from '../types';

// 1. Define input schema
const yourToolInputSchema = z.object({
  requiredParam: z.string(),
  optionalParam: z.string().optional()
});

// 2. Define output types
export interface YourToolOutput {
  result: string;
  metadata?: Record<string, unknown>;
}

export interface YourToolError {
  error: string;
}

// 3. Create factory function
export function createYourTool(sandbox: Sandbox, config?: ToolConfig) {
  return tool({
    description: 'Clear, concise description for the AI model',
    inputSchema: zodSchema(yourToolInputSchema),
    execute: async (input): Promise<YourToolOutput | YourToolError> => {
      try {
        // Use sandbox methods: exec, readFile, writeFile, etc.
        const result = await sandbox.exec(input.requiredParam);
        return { result: result.stdout };
      } catch (err) {
        return { error: String(err) };
      }
    }
  });
}
```

2. **Export from tools index**: `/src/tools/index.ts`

```typescript
export { createYourTool } from './your-tool';
export type { YourToolOutput, YourToolError } from './your-tool';
```

3. **Add to tool factory**: `/src/tools/index.ts` in `createAgentTools()`

```typescript
export function createAgentTools(sandbox: Sandbox, config?: AgentConfig) {
  const tools = {
    Bash: createBashTool(sandbox, config?.tools?.Bash),
    // ... other tools
    YourTool: createYourTool(sandbox, config?.tools?.YourTool)
  };
  return tools;
}
```

4. **Update types if needed**: Add config types to `/src/types.ts`

**Reference**: See `/src/tools/bash.ts` for complete example

---

### Task 2: Implementing a New Sandbox

**Step-by-step**:

1. **Create sandbox file**: `/src/sandbox/your-sandbox.ts`

```typescript
import type { Sandbox, ExecOptions, ExecResult } from './interface';

export function createYourSandbox(options?: { workingDirectory?: string }): Sandbox {
  const workingDir = options?.workingDirectory ?? '/tmp';

  return {
    async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
      const startTime = Date.now();
      const controller = new AbortController();

      // Handle timeout
      const timeoutId = options?.timeout
        ? setTimeout(() => controller.abort(), options.timeout)
        : undefined;

      try {
        // Your execution logic here
        // Example: spawn process, capture output, etc.

        return {
          stdout: '...',
          stderr: '...',
          exit_code: 0,
          interrupted: false,
          duration_ms: Date.now() - startTime
        };
      } catch (error) {
        throw new Error(`Execution failed: ${error}`);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    },

    async readFile(path: string): Promise<string> {
      // Implementation
    },

    async writeFile(path: string, content: string): Promise<void> {
      // Implementation
    },

    async readDir(path: string): Promise<string[]> {
      // Implementation
    },

    async fileExists(path: string): Promise<boolean> {
      // Implementation
    },

    async isDirectory(path: string): Promise<boolean> {
      // Implementation
    },

    async destroy(): Promise<void> {
      // Cleanup resources
    }
  };
}
```

2. **Export from sandbox index**: `/src/sandbox/index.ts`

```typescript
export { createYourSandbox } from './your-sandbox';
```

3. **Export from main index**: `/src/index.ts`

```typescript
export { createYourSandbox } from './sandbox';
```

**Reference**:
- Simple: `/src/sandbox/local.ts`
- Complex: `/src/sandbox/vercel.ts`

---

### Task 3: Adding Configuration Options

**Step-by-step**:

1. **Add types**: `/src/types.ts`

```typescript
// Per-tool config
export type ToolConfig = {
  timeout?: number;
  maxFileSize?: number;
  // Add your new option
  yourNewOption?: string;
};

// Or for global config
export type AgentConfig = {
  tools?: Record<string, ToolConfig>;
  // Add your new option
  yourGlobalOption?: boolean;
};
```

2. **Update defaults** (if needed): `/src/types.ts`

```typescript
export const DEFAULT_CONFIG: AgentConfig = {
  defaultTimeout: 120000,
  workingDirectory: '/tmp',
  yourGlobalOption: false  // Add default
};
```

3. **Use in tool**: Pass config through factory and apply in execute

```typescript
export function createYourTool(sandbox: Sandbox, config?: ToolConfig) {
  const yourOption = config?.yourNewOption ?? 'default';

  return tool({
    // ...
    execute: async (input) => {
      // Use yourOption here
    }
  });
}
```

4. **Document**: Update README.md configuration section

---

### Task 4: Adding Middleware

**Step-by-step**:

1. **Create middleware file**: `/src/middleware/your-middleware.ts`

```typescript
import type { LanguageModelV2Middleware } from 'ai';

export const yourMiddleware: LanguageModelV2Middleware = {
  transformParams: async ({ params }) => {
    // Modify params before model invocation
    return {
      ...params,
      // Your modifications
    };
  },

  // Or use wrapGenerate for post-processing
  wrapGenerate: async ({ doGenerate, params }) => {
    const result = await doGenerate();
    // Post-process result
    return result;
  }
};
```

2. **Export from middleware index**: `/src/middleware/index.ts`

```typescript
export { yourMiddleware } from './your-middleware';
```

3. **Export from main index**: `/src/index.ts`

```typescript
export { yourMiddleware } from './middleware';
```

4. **Document usage**: Update README.md

**Reference**: `/src/middleware/anthropic-cache.ts` for prompt caching example

---

## Code Conventions

### Naming Conventions

| Element | Convention | Examples |
|---------|------------|----------|
| Tool names | PascalCase | `Bash`, `Read`, `Write`, `WebSearch` |
| Factory functions | `createX` prefix | `createBashTool`, `createLocalSandbox` |
| Output types | `XOutput` suffix | `BashOutput`, `ReadOutput` |
| Error types | `XError` suffix | `BashError`, `ReadError` |
| Config types | `XConfig` suffix | `ToolConfig`, `AgentConfig` |
| Files | kebab-case | `bash.ts`, `anthropic-cache.ts` |

### Type Organization

**Input Schemas** - Colocated with tool implementation:
```typescript
// In /src/tools/bash.ts
const bashInputSchema = z.object({
  command: z.string(),
  description: z.string()
});
```

**Output Types** - Exported from tool files:
```typescript
export interface BashOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface BashError {
  error: string;
}
```

**Union Types** - Tools return `Output | Error`:
```typescript
execute: async (input): Promise<BashOutput | BashError> => {
  // Implementation
}
```

**Config Types** - Centralized in `/src/types.ts`:
```typescript
export type ToolConfig = { /* ... */ };
export type AgentConfig = { /* ... */ };
```

### Error Handling

**Pattern**: Return error objects, don't throw

```typescript
// ✅ Correct
try {
  const result = await sandbox.exec(command);
  return { stdout: result.stdout };
} catch (err) {
  return { error: String(err) };
}

// ❌ Incorrect
try {
  const result = await sandbox.exec(command);
  return { stdout: result.stdout };
} catch (err) {
  throw err; // Don't throw from tools
}
```

**Exception**: Sandbox methods can throw (tools catch them)

### Configuration Pattern

**Accept optional config, merge with defaults**:

```typescript
export function createBashTool(sandbox: Sandbox, config?: ToolConfig) {
  const timeout = config?.timeout ?? 120000;
  const maxOutput = config?.maxOutputLength ?? 30000;

  return tool({
    execute: async (input) => {
      // Use timeout, maxOutput
    }
  });
}
```

**Optional features enabled by config presence**:

```typescript
// WebSearch only added if config provided
if (config?.webSearch) {
  tools.WebSearch = createWebSearchTool(config.webSearch);
}
```

---

## Important Notes & Gotchas

### Dependencies

**Peer Dependencies** (required):
- `ai` ^5.0.0 - Vercel AI SDK
- `zod` ^4.1.8 - Schema validation

**Optional Peer Dependencies**:
- `@vercel/sandbox` ^1.0.0 - Vercel execution environment
- `@e2b/code-interpreter` ^1.0.0 - E2B code execution
- `parallel-web` ^1.0.0 - Web search/fetch operations

**Why optional?** Users choose their execution environment:
- LocalSandbox (no deps) for development
- VercelSandbox (requires `@vercel/sandbox`) for production
- E2BSandbox (requires `@e2b/code-interpreter`) for hosted execution

**Build externals**: All dependencies marked as external to prevent bundling duplication.

### Testing Strategy

**No formal test suite** - intentional design choice:
- Examples serve as integration tests
- `/examples/test-tools.ts` - Direct tool API testing (no AI model needed)
- `/examples/basic.ts` - Full agentic loop with Claude
- `/examples/test-web-tools.ts` - Web tools demonstration

**Before releases**:
1. Run all examples to verify functionality
2. Test each sandbox implementation
3. Verify type generation (`bun run build`)

### Breaking Changes to Avoid

**Public APIs** (require major version bump):

1. **Sandbox interface** (`/src/sandbox/interface.ts`)
   - Adding methods breaks implementers
   - Changing method signatures breaks all sandboxes

2. **Tool input schemas**
   - AI models rely on these
   - Removing fields breaks existing prompts

3. **Tool output types**
   - Consumers depend on these shapes
   - Removing fields breaks user code

4. **Tool names**
   - Used in AI prompts (e.g., "use the Bash tool")
   - Renaming breaks prompt compatibility

**Safe changes** (minor/patch versions):
- Adding new optional config fields
- Adding new tools
- Adding new sandbox implementations
- Internal refactoring
- Bug fixes

### Performance Considerations

**Tool Result Caching**:
```typescript
// Enable caching for read-only tools
const { tools } = createAgentTools(sandbox, { cache: true });

// Custom TTL and per-tool control
const { tools } = createAgentTools(sandbox, {
  cache: {
    ttl: 10 * 60 * 1000,  // 10 minutes
    debug: true,          // Log cache hits/misses
    Read: true,
    Glob: true,
    WebFetch: false,      // Disable for this tool
  }
});

// Check cache stats
const readTool = tools.Read as CachedTool;
console.log(readTool.getStats());
// { hits: 5, misses: 2, hitRate: 0.71, size: 2 }
```
Returns cached results for identical tool calls. Default TTL: 5 minutes.

**Prompt Caching**:
```typescript
import { anthropicPromptCacheMiddleware } from 'bashkit';

const model = wrapLanguageModel({
  model: anthropic('claude-sonnet-4-5'),
  middleware: anthropicPromptCacheMiddleware
});
```
Reduces cost/latency for repeated prompts (3+ messages).

**Message Pruning**:
```typescript
import { pruneMessages } from 'bashkit';

const pruned = pruneMessages(messages, {
  maxTokens: 100000,
  protectRecentUserMessages: 3
});
```
Keeps conversations within token limits.

**Sandbox Choice**:
- **LocalSandbox**: Fastest (Bun APIs), use for development
- **VercelSandbox**: Production-ready, Firecracker isolation
- **E2BSandbox**: Hosted, good for serverless environments

**Timeout Configuration**:
```typescript
const { tools } = createAgentTools(sandbox, {
  defaultTimeout: 30000, // 30 seconds instead of 120s
  tools: {
    Bash: { timeout: 10000 } // Override per-tool
  }
});
```

### Security Notes

**Bash Tool Risks**:
- Executes arbitrary commands
- Can access filesystem, network, system
- Use `blockedCommands` to restrict dangerous operations

**Configuration-Based Security**:

```typescript
const { tools } = createAgentTools(sandbox, {
  tools: {
    Bash: {
      blockedCommands: ['rm -rf', 'dd if=', 'curl'],
      timeout: 10000
    },
    Read: {
      allowedPaths: ['/workspace/**'] // Restrict file access
    },
    Write: {
      maxFileSize: 1_000_000, // 1MB limit
      allowedPaths: ['/workspace/**']
    }
  }
});
```

**Best Practices**:
- Always set timeouts to prevent hanging
- Use allowedPaths for file operations
- Block dangerous bash commands
- Set file size limits
- Run in sandboxed environments (Vercel/E2B) for production
- Don't expose directly to untrusted users without additional controls

---

## Additional Resources

- **GitHub**: https://github.com/jbreite/bashkit
- **npm**: `bashkit` (v0.1.0)
- **Examples**: See `/examples/` directory
- **Issues**: Report bugs on GitHub Issues

---

*Last Updated*: 2026-01-02
*For*: Claude Code and AI coding assistants
