# AGENTS.md - Using bashkit

bashkit provides agentic coding tools for the Vercel AI SDK. This guide helps AI agents use bashkit when building applications.

## Installation

<!-- TODO: Update when published to npm -->
```bash
# Not yet published - use bun link for local development
cd /path/to/bashkit && bun link
cd /path/to/your-project && bun link @jbreite/bashkit

# Also install peer dependencies
bun add ai @ai-sdk/anthropic
```

## Quick Setup

### LocalSandbox (Development)

Runs commands directly on the local machine. Use for development/testing only.

```typescript
import { createAgentTools, LocalSandbox } from "@jbreite/bashkit";

const sandbox = new LocalSandbox("/tmp/workspace");
const tools = createAgentTools(sandbox);
```

### VercelSandbox (Production)

Runs in isolated Firecracker microVMs on Vercel's infrastructure.

```typescript
import { createAgentTools, VercelSandbox } from "@jbreite/bashkit";

const sandbox = new VercelSandbox({
  runtime: "node22",
  resources: { vcpus: 2 },
});
const tools = createAgentTools(sandbox);

// Don't forget to cleanup
await sandbox.destroy();
```

## Available Tools

### Sandbox-based Tools (from createAgentTools)

| Tool | Purpose | Key Inputs |
|------|---------|------------|
| `Bash` | Execute shell commands | `command`, `timeout?`, `description?` |
| `Read` | Read files or list directories | `file_path`, `offset?`, `limit?` |
| `Write` | Create/overwrite files | `file_path`, `content` |
| `Edit` | Replace strings in files | `file_path`, `old_string`, `new_string`, `replace_all?` |
| `Glob` | Find files by pattern | `pattern`, `path?` |
| `Grep` | Search file contents | `pattern`, `path?`, `output_mode?`, `-i?`, `-C?` |

### Workflow Tools (created separately)

| Tool | Purpose | Factory |
|------|---------|---------|
| `Task` | Spawn sub-agents | `createTaskTool({ model, tools, subagentTypes? })` |
| `TodoWrite` | Track task progress | `createTodoWriteTool(state, config?, onUpdate?)` |
| `ExitPlanMode` | Exit planning mode | `createExitPlanModeTool(config?, onPlanSubmit?)` |

## Using with AI SDK generateText

```typescript
import { generateText, wrapLanguageModel, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  createAgentTools,
  LocalSandbox,
  anthropicPromptCacheMiddleware,
} from "@jbreite/bashkit";

const sandbox = new LocalSandbox("/tmp/workspace");
const tools = createAgentTools(sandbox);

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

The Task tool spawns new `generateText` calls for complex subtasks:

```typescript
import { createTaskTool } from "@jbreite/bashkit";

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

## Prompt Caching

Enable Anthropic prompt caching to reduce costs on repeated prefixes:

```typescript
import { wrapLanguageModel } from "ai";
import { anthropicPromptCacheMiddleware } from "@jbreite/bashkit";

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

## Common Patterns

### Full Agent Setup

```typescript
import { generateText, wrapLanguageModel, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  createAgentTools,
  createTaskTool,
  createTodoWriteTool,
  LocalSandbox,
  anthropicPromptCacheMiddleware,
  type TodoState,
} from "@jbreite/bashkit";

// 1. Create sandbox
const sandbox = new LocalSandbox("/tmp/workspace");

// 2. Create sandbox tools
const sandboxTools = createAgentTools(sandbox);

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
const tools = createAgentTools(sandbox, {
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

