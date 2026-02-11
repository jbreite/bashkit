# BashKit - Claude Code Guide

> Agentic coding tools for Vercel AI SDK

**Tech Stack**: TypeScript • Bun • Vercel AI SDK • Zod
**Inspired by**: Claude Code tools
**Version**: 0.4.0

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
├── sandbox/         # Execution environment abstractions (see src/sandbox/AGENTS.md)
├── tools/           # Tool implementations (see src/tools/AGENTS.md)
├── cache/           # Tool result caching (see src/cache/AGENTS.md)
├── middleware/      # Vercel AI SDK middleware (see src/middleware/AGENTS.md)
├── utils/           # Utility functions (see src/utils/AGENTS.md)
├── skills/          # Agent Skills standard (see src/skills/AGENTS.md)
├── setup/           # Agent environment setup (see src/setup/AGENTS.md)
├── cli/             # CLI initialization (see src/cli/AGENTS.md)
├── types.ts         # Configuration types
└── index.ts         # Main exports (barrel file)
```

Each folder has its own `AGENTS.md` with detailed file descriptions, key exports, architecture, and modification guides.

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
  readonly id?: string;  // Sandbox ID for reconnection (cloud only)
  rgPath?: string;       // Path to ripgrep (set by ensureSandboxTools)
}
```

**Note**: `createVercelSandbox()` and `createE2BSandbox()` are async and auto-setup ripgrep:
```typescript
const sandbox = await createE2BSandbox({ apiKey: '...' });
// rgPath is already set, Grep tool works immediately
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
  description: z.string().nullable(),
  timeout: z.number().nullable()
});
```

#### 6. Nullable Types for AI Provider Compatibility

All optional tool parameters use `.nullable()` instead of `.optional()` for OpenAI structured outputs compatibility.

**Why `.nullable()` instead of `.optional()`:**
- OpenAI structured outputs require all properties in the `required` array
- `.optional()` removes properties from `required` (breaks OpenAI)
- `.nullable()` keeps properties in `required` but allows `null` values
- Works with both OpenAI and Anthropic models

**Pattern for handling nullable values:**
```typescript
// Zod schema uses .nullable()
const schema = z.object({
  timeout: z.number().nullable(),
  replace_all: z.boolean().nullable(),
});

// In execute function, use ?? for defaults
// NOTE: Destructuring defaults (= value) only work with undefined, NOT null
const { timeout, replace_all: rawReplaceAll } = input;
const effectiveTimeout = timeout ?? 120000;
const replaceAll = rawReplaceAll ?? false;
```

**Type conventions:**
- Zod schemas: `.nullable()` → produces `T | null`
- Exported interfaces: `T | null` (e.g., `description: string | null`)
- Internal functions: `T | null` for parameters that accept nullable values

#### 7. Tool Result Caching
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

Each `src/` subfolder has an `AGENTS.md` with detailed file listings and guides. Key entry points:

- **Configuration**: `/src/types.ts` (ToolConfig, AgentConfig, DEFAULT_CONFIG)
- **Main exports**: `/src/index.ts` (barrel file)
- **Package config**: `/package.json`
- **Examples**: `/examples/basic.ts`, `/examples/test-tools.ts`, `/examples/test-web-tools.ts`

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

**Unit tests** use Vitest (run via `bun run test`, NOT `bun test`):

```bash
# Run all tests
bun run test

# Run specific test file(s)
bun run test tests/utils/budget-tracking.test.ts

# Watch mode
bun run test:watch
```

**Examples** serve as integration tests:

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

Each task has a detailed step-by-step guide in the relevant folder's `AGENTS.md`:

| Task | Guide Location |
|------|---------------|
| Adding a new tool | `src/tools/AGENTS.md` → "Common Modifications" |
| Implementing a new sandbox | `src/sandbox/AGENTS.md` → "Common Modifications" |
| Adding middleware | `src/middleware/AGENTS.md` → "Common Modifications" |
| Adding a cache backend | `src/cache/AGENTS.md` → "Common Modifications" |
| Adding configuration options | Add types to `/src/types.ts`, use in tool factory via `config?.yourOption ?? default` |
| Adding a skill source | `src/skills/AGENTS.md` → "Common Modifications" |
| Setting up agent environments | `src/setup/AGENTS.md` → "Common Modifications" |

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

**Unit tests** via Vitest (`bun run test`):
- `/tests/tools/` - Tool unit and integration tests
- `/tests/utils/` - Utility function tests

**Examples** as integration tests:
- `/examples/test-tools.ts` - Direct tool API testing (no AI model needed)
- `/examples/basic.ts` - Full agentic loop with Claude
- `/examples/test-web-tools.ts` - Web tools demonstration

**Before releases**:
1. Run `bun run test` to verify all unit tests pass
2. Run all examples to verify functionality
3. Test each sandbox implementation
4. Verify type generation (`bun run build`)

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

*Last Updated*: 2026-01-22
*For*: Claude Code and AI coding assistants
