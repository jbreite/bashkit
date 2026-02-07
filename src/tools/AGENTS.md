# Tools Module

The tools module implements all 15 AI agent tools in BashKit. These tools bridge AI models with sandbox execution environments, enabling agents to perform file operations, run commands, search code, fetch web content, manage workflows, and interact with users. Each tool follows the Vercel AI SDK tool() pattern with Zod schemas for input validation and structured error handling.

## Files

| File | Purpose |
|------|---------|
| `bash.ts` | Execute shell commands with timeout and output limits |
| `read.ts` | Read files and list directories with pagination support |
| `write.ts` | Write files with size limits and path restrictions |
| `edit.ts` | String-based find/replace editing with uniqueness validation |
| `glob.ts` | Pattern-based file discovery using find command |
| `grep.ts` | Ripgrep-powered content search with context and filtering |
| `ask-user.ts` | Interactive Q&A with simple and structured question formats |
| `enter-plan-mode.ts` | Enter planning mode for explore-then-execute workflows |
| `exit-plan-mode.ts` | Exit planning mode and submit plan for approval |
| `skill.ts` | Activate pre-loaded skills from SKILL.md files |
| `task.ts` | Spawn sub-agents for autonomous multi-step tasks |
| `todo-write.ts` | Manage structured task lists with state tracking |
| `web-search.ts` | Search the web via Parallel API with domain filtering |
| `web-fetch.ts` | Fetch and process web content with AI model |
| `index.ts` | Tool factory orchestration and caching layer |

## Key Exports

### Factory Functions
- `createAgentTools(sandbox, config?)` -- Main orchestrator that assembles all tools based on config
- `createBashTool(sandbox, config?)` -- Shell command execution
- `createReadTool(sandbox, config?)` -- File/directory reading
- `createWriteTool(sandbox, config?)` -- File writing
- `createEditTool(sandbox, config?)` -- String replacement editing
- `createGlobTool(sandbox, config?)` -- File pattern matching
- `createGrepTool(sandbox, config?)` -- Content search with ripgrep
- `createAskUserTool(config?)` -- User interaction tool
- `createEnterPlanModeTool(state, onEnter?)` -- Planning mode entry
- `createExitPlanModeTool(onPlanSubmit?)` -- Planning mode exit
- `createSkillTool(config)` -- Skill activation
- `createTaskTool(config)` -- Sub-agent spawning
- `createTodoWriteTool(state, onUpdate?)` -- Task list management
- `createWebSearchTool(config)` -- Web search
- `createWebFetchTool(config)` -- Web content fetching

### Output Types
Each tool exports `<Name>Output` for success and `<Name>Error` for errors:
- Sandbox tools: `BashOutput | BashError`, `ReadOutput | ReadError`, etc.
- Interactive tools: `AskUserOutput | AskUserError`, etc.
- Workflow tools: `TaskOutput | TaskError`, `TodoWriteOutput | TodoWriteError`
- Web tools: `WebSearchOutput | WebSearchError`, `WebFetchOutput | WebFetchError`

### Configuration Types
- `AgentConfig` -- Top-level config for createAgentTools()
- `ToolConfig` -- Per-tool config (timeout, allowedPaths, maxFileSize, etc.)
- `AskUserConfig` -- Ask user handlers
- `SkillConfig` -- Skill metadata and sandbox
- `TaskToolConfig` -- Sub-agent configuration
- `WebSearchConfig` / `WebFetchConfig` -- Web tool API keys and providers

## Architecture

### Tool Categories

**Core Sandbox Tools** (always enabled):
- Bash, Read, Write, Edit, Glob, Grep -- Direct sandbox operations via Sandbox interface

**Interactive Tools** (opt-in via config):
- AskUser -- User Q&A with simple and structured formats
- EnterPlanMode, ExitPlanMode -- Plan-then-execute workflow
- Skill -- Load specialized instructions from SKILL.md files

**Workflow Tools** (require Task tool config):
- Task -- Spawn sub-agents with custom system prompts and tool restrictions
- TodoWrite -- Shared state management for task tracking

**Web Tools** (opt-in via config, require parallel-web):
- WebSearch -- Search via Parallel API
- WebFetch -- Extract and process web content with AI model

### Data Flow

1. **Tool Creation**: `createAgentTools()` → individual `create*Tool()` factories → `tool()` from AI SDK
2. **Execution**: AI model calls tool → `execute()` function → sandbox operation or external API → return Output or Error
3. **Caching** (optional): `resolveCache()` wraps cacheable tools with `cached()` from cache module
4. **Export**: Tools surfaced via `src/index.ts` barrel export to package consumers

### Internal Dependencies

**Within tools module**:
- `index.ts` imports all tool factories and orchestrates assembly
- Tools are independent (no cross-imports between tool files)

**External dependencies**:
- `../sandbox/interface.ts` -- Sandbox abstraction for Bash/Read/Write/Edit/Glob/Grep
- `../types.ts` -- Config types and DEFAULT_CONFIG
- `../cache/` -- Caching layer for Read, Glob, Grep, WebFetch, WebSearch
- `../utils/debug.ts` -- Debug logging for all tools
- `../skills/types.ts` -- Skill metadata for Skill tool
- `ai` -- tool(), zodSchema(), generateText(), streamText() from Vercel AI SDK
- `zod` -- Schema validation for all tool inputs
- `parallel-web` -- Dynamic import for WebSearch and WebFetch (peer dependency)

## Design Patterns

### Nullable Types for OpenAI Compatibility
All optional tool parameters use `.nullable().default(null)` instead of `.optional()` for OpenAI structured outputs compatibility. In execute functions, use `?? defaultValue` (NOT destructuring defaults) since defaults only work with `undefined`, not `null`.

```typescript
// Schema
const schema = z.object({
  timeout: z.number().nullable().default(null),
  replace_all: z.boolean().nullable().default(null),
});

// Execute function
const { timeout, replace_all: rawReplaceAll } = input;
const effectiveTimeout = timeout ?? 120000;  // ✅ Correct
const replaceAll = rawReplaceAll ?? false;   // ✅ Correct
```

### Return-Error-Not-Throw Pattern
Tools return error objects instead of throwing to provide structured error responses to the AI model:

```typescript
try {
  const result = await sandbox.exec(command);
  return { stdout: result.stdout };  // Success
} catch (err) {
  return { error: String(err) };     // Error
}
```

### Factory Pattern with Config Merging
Each tool factory accepts optional config and merges with defaults:

```typescript
export function createBashTool(sandbox: Sandbox, config?: ToolConfig) {
  const maxOutputLength = config?.maxOutputLength ?? 30000;
  const defaultTimeout = config?.timeout ?? 120000;
  // ...
}
```

### Debug Logging Integration
All tools use debug utils for structured logging:

```typescript
const debugId = isDebugEnabled()
  ? debugStart("bash", { command, timeout })
  : "";

// ... operation ...

if (debugId) {
  debugEnd(debugId, "bash", { summary, duration_ms });
}
```

### Tool Caching via Wrapper
Cacheable tools (Read, Glob, Grep, WebFetch, WebSearch) wrapped by `cached()` function in index.ts based on config. Cache uses tool name + input hash as key.

## Integration Points

### Depends on
- `../sandbox/` -- Sandbox interface and implementations (LocalSandbox, VercelSandbox, E2BSandbox)
- `../types.ts` -- Configuration types and defaults
- `../cache/` -- Caching infrastructure (LRUCacheStore, cached wrapper)
- `../utils/` -- Debug logging, token estimation
- `../skills/` -- Skill metadata types

### Used by
- `src/index.ts` -- Main barrel export that re-exports all tool factories and types
- External consumers via package entry point

### Exported from
All tool factories and types exported via `src/index.ts`:
- Individual tool factories: `createBashTool`, `createReadTool`, etc.
- Main orchestrator: `createAgentTools` (returns `AgentToolsResult` with tools and optional state)
- Output/error types for all tools
- Config types: `AgentConfig`, `ToolConfig`, etc.

## Common Modifications

### Adding a New Sandbox-Based Tool
1. Create `/src/tools/your-tool.ts` following the bash.ts pattern
2. Define Zod input schema with `.nullable().default(null)` for optional params
3. Define `YourToolOutput` and `YourToolError` interfaces
4. Implement `createYourTool(sandbox: Sandbox, config?: ToolConfig)` factory
5. Add to `index.ts`: import factory, add to `tools` object in `createAgentTools()`
6. Export types and factory from `index.ts`
7. Re-export from `src/index.ts`

### Adding a New Web-Based Tool
Similar to sandbox tools but:
1. Import web API dynamically like web-fetch.ts (module cache pattern)
2. Handle API errors with status codes and retryable flag
3. Add provider config to `types.ts` (WebSearchConfig pattern)
4. Use `debugStart/End/Error` for structured logging

### Adding Tool to Default Cache List
Edit `DEFAULT_CACHEABLE` array in `index.ts`:
```typescript
const DEFAULT_CACHEABLE = [
  "Read", "Glob", "Grep", "WebFetch", "WebSearch",
  "YourTool"  // Add here
] as const;
```

### Adding Custom Tool Configuration
1. Add config fields to `ToolConfig` in `src/types.ts`
2. Use in tool factory: `const yourOption = config?.yourOption ?? defaultValue;`
3. Apply in execute function

### Modifying Input Schema
**CAUTION**: Changing schemas is breaking for AI models. Safe changes:
- Adding new optional (`.nullable().default(null)`) fields
- Adding to description strings

**BREAKING**: Removing fields, renaming fields, changing types

## Testing

### Test Coverage
Located at `/tests/tools/`:
- `bash.test.ts` -- Command execution, timeouts, output truncation
- `read.test.ts` -- File reading, directory listing, pagination, binary detection
- `write.test.ts` -- File creation, overwriting, size limits
- `edit.test.ts` -- String replacement, uniqueness validation, replace_all
- `glob.test.ts` -- Pattern matching, path filtering
- `grep.test.ts` -- Content search, output modes, context lines, pagination
- `todo-write.test.ts` -- Task state management
- `web-search.test.ts` -- Parallel API search (requires PARALLEL_API_KEY)
- `web-fetch.test.ts` -- Web content extraction (requires PARALLEL_API_KEY)
- `index.test.ts` -- Tool factory orchestration, caching

### Running Tests
```bash
# All tool tests
bun test tests/tools/

# Specific tool
bun test tests/tools/bash.test.ts

# Web tools (requires API key)
PARALLEL_API_KEY=xxx bun test tests/tools/web-search.test.ts
```

### Coverage Gaps
- No tests for: `ask-user.ts`, `enter-plan-mode.ts`, `exit-plan-mode.ts`, `skill.ts`, `task.ts`
- These tools require runtime integration (user interaction, plan mode state, skills, sub-agents)
- Test via examples: `/examples/basic.ts` for full agent loop
