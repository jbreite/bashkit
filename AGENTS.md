# AGENTS.md - Using bashkit

bashkit provides agentic coding tools for the Vercel AI SDK. This guide helps AI agents use bashkit when building applications.

## Installation

```bash
npm install bashkit ai @ai-sdk/anthropic
# or
pnpm add bashkit ai @ai-sdk/anthropic
# or
yarn add bashkit ai @ai-sdk/anthropic
# or
bun add bashkit ai @ai-sdk/anthropic
```

## Quick Setup

### LocalSandbox (Development)

Runs commands directly on the local machine. Use for development/testing only.

```typescript
import { createAgentTools, createLocalSandbox } from "bashkit";

const sandbox = createLocalSandbox({ cwd: "/tmp/workspace" });
const { tools } = createAgentTools(sandbox);
```

### VercelSandbox (Production)

Runs in isolated Firecracker microVMs on Vercel's infrastructure.

```typescript
import { createAgentTools, createVercelSandbox } from "bashkit";

const sandbox = createVercelSandbox({
  runtime: "node22",
  resources: { vcpus: 2 },
});
const { tools } = createAgentTools(sandbox);

// Don't forget to cleanup
await sandbox.destroy();
```

### E2BSandbox (Production)

Runs in E2B's cloud sandboxes. Requires `@e2b/code-interpreter` peer dependency.

```typescript
import { createAgentTools, createE2BSandbox } from "bashkit";

const sandbox = createE2BSandbox({
  apiKey: process.env.E2B_API_KEY,
});
const { tools } = createAgentTools(sandbox);

await sandbox.destroy();
```

### Sandbox Reconnection (Cloud Sandboxes)

Cloud sandboxes (E2B, Vercel) support reconnection via the `id` property and `sandboxId` config:

```typescript
// Create a new sandbox
const sandbox = createE2BSandbox({ apiKey: process.env.E2B_API_KEY });

// After first operation, the sandbox ID is available
await sandbox.exec("echo hello");
const sandboxId = sandbox.id; // "sbx_abc123..."

// Store sandboxId in your database (e.g., chat metadata)
await db.chat.update({ where: { id: chatId }, data: { sandboxId } });

// Later: reconnect to the same sandbox
const savedId = chat.sandboxId;
const reconnected = createE2BSandbox({
  apiKey: process.env.E2B_API_KEY,
  sandboxId: savedId, // Reconnects instead of creating new
});
```

This is useful for:
- Reusing sandboxes across multiple requests in the same conversation
- Persisting sandbox state between server restarts
- Reducing sandbox creation overhead

## Available Tools

### Default Tools (always included)

| Tool | Purpose | Key Inputs |
|------|---------|------------|
| `Bash` | Execute shell commands | `command`, `timeout?`, `description?` |
| `Read` | Read files or list directories | `file_path`, `offset?`, `limit?` |
| `Write` | Create/overwrite files | `file_path`, `content` |
| `Edit` | Replace strings in files | `file_path`, `old_string`, `new_string`, `replace_all?` |
| `Glob` | Find files by pattern | `pattern`, `path?` |
| `Grep` | Search file contents | `pattern`, `path?`, `output_mode?`, `-i?`, `-C?` |

### Optional Tools (via config)

| Tool | Purpose | Config Key |
|------|---------|------------|
| `AskUser` | Ask user clarifying questions | `askUser: { onQuestion? }` |
| `EnterPlanMode` | Enter planning/exploration mode | `planMode: true` |
| `ExitPlanMode` | Exit planning mode with a plan | `planMode: true` |
| `Skill` | Execute skills | `skill: { skills }` |
| `WebSearch` | Search the web | `webSearch: { apiKey }` |
| `WebFetch` | Fetch URL and process with AI | `webFetch: { apiKey, model }` |

### Workflow Tools (created separately)

| Tool | Purpose | Factory |
|------|---------|---------|
| `Task` | Spawn sub-agents | `createTaskTool({ model, tools, subagentTypes? })` |
| `TodoWrite` | Track task progress | `createTodoWriteTool(state, config?, onUpdate?)` |

### Web Tools (require `parallel-web` peer dependency)

| Tool | Purpose | Factory |
|------|---------|---------|
| `WebSearch` | Search the web | `createWebSearchTool({ apiKey })` |
| `WebFetch` | Fetch URL and process with AI | `createWebFetchTool({ apiKey, model })` |

## Using with AI SDK generateText

```typescript
import { generateText, wrapLanguageModel, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  createAgentTools,
  createLocalSandbox,
  anthropicPromptCacheMiddleware,
} from "bashkit";

const sandbox = createLocalSandbox({ cwd: "/tmp/workspace" });
const { tools } = createAgentTools(sandbox);

// Wrap model with prompt caching (recommended)
const model = wrapLanguageModel({
  model: anthropic("claude-sonnet-4-20250514"),
  middleware: anthropicPromptCacheMiddleware,
});

const result = await generateText({
  model,
  tools,
  system: "You are a helpful coding assistant.",
  prompt: "Create a hello world TypeScript file and run it",
  stopWhen: stepCountIs(10), // Allow up to 10 tool-call rounds
  onStepFinish: ({ finishReason, toolCalls, toolResults, usage }) => {
    // Log progress
    console.log(`Step finished: ${finishReason}`);
    for (const call of toolCalls || []) {
      console.log(`  Tool: ${call.toolName}`);
    }
  },
});

await sandbox.destroy();
```

## Sub-agents with Task Tool

The Task tool spawns new agents for complex subtasks:

```typescript
import { createTaskTool } from "bashkit";

const taskTool = createTaskTool({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: sandboxTools,
  subagentTypes: {
    research: {
      model: anthropic("claude-haiku-3"), // Cheaper model for research
      systemPrompt: "You are a research specialist. Find information only.",
      tools: ["Read", "Grep", "Glob"], // Limited tools
    },
    coding: {
      systemPrompt: "You are a coding expert. Write clean code.",
      tools: ["Read", "Write", "Edit", "Bash"],
    },
  },
});

// Add to tools
const allTools = { ...sandboxTools, Task: taskTool };
```

The parent agent calls Task like any other tool:
```typescript
// Agent decides to delegate:
{ tool: "Task", args: {
  description: "Research API patterns",
  prompt: "Find best practices for REST APIs",
  subagent_type: "research"
}}
```

### Streaming Sub-agent Activity to UI

Pass a `streamWriter` to stream real-time sub-agent activity:

```typescript
import { createUIMessageStream } from "ai";

const stream = createUIMessageStream({
  execute: async ({ writer }) => {
    const taskTool = createTaskTool({
      model,
      tools: sandboxTools,
      streamWriter: writer, // Enable real-time streaming
      subagentTypes: { ... },
    });

    const result = streamText({
      model,
      tools: { Task: taskTool },
      ...
    });

    writer.merge(result.toUIMessageStream());
  },
});
```

When `streamWriter` is provided:
- Uses `streamText` internally (instead of `generateText`)
- Emits `data-subagent` events: `start`, `tool-call`, `done`, `complete`
- Events appear in `message.parts` as `{ type: "data-subagent", data: SubagentEventData }`

**Note:** TaskOutput does NOT include messages (to avoid context bloat). The UI accesses the full conversation via the streamed `complete` event.

## Prompt Caching

Enable Anthropic prompt caching to reduce costs on repeated prefixes:

```typescript
import { wrapLanguageModel } from "ai";
import { anthropicPromptCacheMiddleware } from "bashkit";

const model = wrapLanguageModel({
  model: anthropic("claude-sonnet-4-20250514"),
  middleware: anthropicPromptCacheMiddleware,
});

// Check cache stats in result
console.log({
  cacheCreation: result.providerMetadata?.anthropic?.cacheCreationInputTokens,
  cacheRead: result.providerMetadata?.anthropic?.cacheReadInputTokens,
});
```

## Web Tools

WebSearch and WebFetch tools provide web access capabilities using the [Parallel API](https://docs.parallel.ai).

### Setup

```bash
# Install the parallel-web peer dependency
bun add parallel-web

# Set your API key
export PARALLEL_API_KEY="your_api_key"
```

### WebSearch

Search the web and get formatted results:

```typescript
import { createWebSearchTool } from "bashkit";

const webSearch = createWebSearchTool({
  apiKey: process.env.PARALLEL_API_KEY!,
});

// Add to your tools
const tools = {
  ...sandboxTools,
  WebSearch: webSearch,
};
```

**Input:**
- `query` - The search query
- `allowed_domains?` - Only include results from these domains
- `blocked_domains?` - Exclude results from these domains

**Output:**
```typescript
{
  results: Array<{ title: string; url: string; snippet: string; metadata?: Record<string, any> }>;
  total_results: number;
  query: string;
}
```

### WebFetch

Fetch a URL and process the content with an AI model:

```typescript
import { createWebFetchTool } from "bashkit";
import { anthropic } from "@ai-sdk/anthropic";

const webFetch = createWebFetchTool({
  apiKey: process.env.PARALLEL_API_KEY!,
  model: anthropic("claude-haiku-3"), // Use a fast/cheap model for processing
});

// Add to your tools
const tools = {
  ...sandboxTools,
  WebFetch: webFetch,
};
```

**Input:**
- `url` - The URL to fetch
- `prompt` - The prompt to run on the fetched content

**Output:**
```typescript
{
  response: string;      // AI model's response to the prompt
  url: string;
  final_url?: string;    // Final URL after redirects
  status_code?: number;
}
```

## Agent Skills

bashkit supports the [Agent Skills](https://agentskills.io) standard for progressive skill loading.

> **Note:** Skill discovery is for **LocalSandbox** use cases where the agent has filesystem access. For cloud sandboxes, bundle skills with your app directly.

### Discovering Skills (LocalSandbox)

When using LocalSandbox, discover project and user-global skills:

```typescript
import { discoverSkills, skillsToXml } from "bashkit";

// Discovers from .skills/ (project) and ~/.bashkit/skills/ (user-global)
const skills = await discoverSkills();
```

### Using Skills with Agents

```typescript
import { discoverSkills, skillsToXml, createAgentTools, createLocalSandbox } from "bashkit";
import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const skills = await discoverSkills();
const sandbox = createLocalSandbox({ cwd: "/tmp/workspace" });
const { tools } = createAgentTools(sandbox);

const result = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools,
  system: `You are a coding assistant.

${skillsToXml(skills)}

When a task matches a skill, use the Read tool to load its full instructions from the location path.`,
  prompt: "Extract text from invoice.pdf",
  stopWhen: stepCountIs(10),
});
```

### How It Works

1. `discoverSkills()` loads only metadata (name, description, path) - ~50-100 tokens per skill
2. `skillsToXml()` generates XML listing available skills
3. Agent decides when to activate a skill by reading its SKILL.md with the Read tool
4. Full instructions enter context only when the skill is actually used

### Creating Skills

Create `.skills/<skill-name>/SKILL.md`:

```markdown
---
name: pdf-processing
description: Extract text and tables from PDF files.
---

# PDF Processing

Instructions for the agent...
```

### Using Remote Skills

Fetch complete skill folders from GitHub repositories (e.g., Anthropic's official skills):

```typescript
import { fetchSkill, fetchSkills, setupAgentEnvironment } from "bashkit";

// Fetch a single skill (gets all files: SKILL.md, scripts/, etc.)
const pdfSkill = await fetchSkill('anthropics/skills/pdf');

// Or batch fetch multiple
const remoteSkills = await fetchSkills([
  'anthropics/skills/pdf',
  'anthropics/skills/web-research',
]);

// Use with setupAgentEnvironment
const config = {
  skills: {
    ...remoteSkills,
    'my-custom': myContent,
  },
};
const { skills } = await setupAgentEnvironment(sandbox, config);
```

**Format:** `owner/repo/skillName` (fetches entire skill folder from GitHub)

## Setting Up Agent Environments

For cloud sandboxes, use `setupAgentEnvironment` to create workspace directories and seed skills:

```typescript
import { setupAgentEnvironment, skillsToXml, createAgentTools, createVercelSandbox } from "bashkit";

const config = {
  workspace: {
    notes: 'files/notes/',
    outputs: 'files/outputs/',
  },
  skills: {
    'web-research': webResearchSkillContent,
  },
};

const sandbox = createVercelSandbox({});
const { skills } = await setupAgentEnvironment(sandbox, config);

// Use same config in prompt - stays in sync!
const systemPrompt = `Save notes to: ${config.workspace.notes}
${skillsToXml(skills)}
`;

const { tools } = createAgentTools(sandbox);
```

## Common Patterns

### Full Agent Setup

```typescript
import { generateText, wrapLanguageModel, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  createAgentTools,
  createTaskTool,
  createTodoWriteTool,
  createLocalSandbox,
  anthropicPromptCacheMiddleware,
  type TodoState,
} from "bashkit";

// 1. Create sandbox
const sandbox = createLocalSandbox({ cwd: "/tmp/workspace" });

// 2. Create sandbox tools
const { tools: sandboxTools } = createAgentTools(sandbox);

// 3. Create model with caching
const model = wrapLanguageModel({
  model: anthropic("claude-sonnet-4-20250514"),
  middleware: anthropicPromptCacheMiddleware,
});

// 4. Create workflow tools
const todoState: TodoState = { todos: [] };
const todoTool = createTodoWriteTool(todoState);
const taskTool = createTaskTool({ model, tools: sandboxTools });

// 5. Combine all tools
const tools = {
  ...sandboxTools,
  TodoWrite: todoTool,
  Task: taskTool,
};

// 6. Run agent
const result = await generateText({
  model,
  tools,
  system: "You are a coding assistant. Use TodoWrite to plan tasks.",
  prompt: "Build a REST API with Express",
  stopWhen: stepCountIs(15),
});

// 7. Cleanup
await sandbox.destroy();
```

### Tool Configuration

Restrict tools with configuration:

```typescript
const { tools } = createAgentTools(sandbox, {
  tools: {
    Bash: {
      enabled: true,
      blockedCommands: ["rm -rf", "sudo"],
      maxOutputLength: 30000,
    },
    Write: {
      enabled: true,
      allowedPaths: ["/tmp/workspace"],
      maxFileSize: 1_000_000,
    },
  },
});
```

## Tool Result Caching

Cache tool execution results to avoid redundant operations:

```typescript
import { createAgentTools, createLocalSandbox } from "bashkit";

const sandbox = createLocalSandbox({ cwd: "/tmp/workspace" });

// Enable caching with defaults (LRU, 5min TTL)
const { tools } = createAgentTools(sandbox, { cache: true });

// Or customize caching behavior
const { tools } = createAgentTools(sandbox, {
  cache: {
    ttl: 10 * 60 * 1000,  // 10 minutes
    debug: true,          // Log cache hits/misses
    Read: true,           // Enable for Read
    Glob: true,           // Enable for Glob
    Grep: false,          // Disable for Grep
  },
});
```

**Default cached tools:** Read, Glob, Grep, WebFetch, WebSearch

**Not cached by default:** Bash, Write, Edit (have side effects)

### Cache Callbacks

Track cache performance with callbacks:

```typescript
const { tools } = createAgentTools(sandbox, {
  cache: {
    onHit: (toolName, key) => {
      metrics.increment(`cache.hit.${toolName}`);
    },
    onMiss: (toolName, key) => {
      metrics.increment(`cache.miss.${toolName}`);
    },
  },
});
```

### Cache Stats

Cached tools have additional methods:

```typescript
import type { CachedTool } from "bashkit";

const readTool = tools.Read as CachedTool;

// Check cache performance (async for Redis compatibility)
console.log(await readTool.getStats());
// { hits: 5, misses: 2, hitRate: 0.71, size: 2 }

// Clear cache
await readTool.clearCache();        // Clear all
await readTool.clearCache("key");   // Clear specific entry
```

### Redis Cache Store

Use your existing Redis client with the helper:

```typescript
import { createRedisCacheStore, createAgentTools } from "bashkit";

const store = createRedisCacheStore(myRedisClient);
const { tools } = createAgentTools(sandbox, { cache: store });
```

Works with `redis`, `ioredis`, or any client with `get`, `set`, `del`, `keys` methods. TTL is handled by the wrapper for consistent behavior across all cache backends.

### Custom Cache Store

For other backends, implement the `CacheStore` interface:

```typescript
import type { CacheStore } from "bashkit";

const myStore: CacheStore = {
  get(key) { /* return CacheEntry or undefined */ },
  set(key, entry) { /* store entry */ },
  delete(key) { /* remove entry */ },
  clear() { /* remove all entries */ },
  size() { /* optional: return count */ },
};

const { tools } = createAgentTools(sandbox, { cache: myStore });
```

### Standalone Caching

Wrap individual tools with caching:

```typescript
import { cached, LRUCacheStore } from "bashkit";

const cachedTool = cached(myTool, "MyTool", {
  ttl: 60000,       // 1 minute
  debug: true,      // Log cache activity
  store: new LRUCacheStore(500),  // Max 500 entries
});
```

