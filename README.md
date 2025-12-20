# bashkit

Agentic coding tools for Vercel AI SDK. Give AI agents the ability to execute code, read/write files, and perform coding tasks in a sandboxed environment.

## Overview

`bashkit` provides a set of tools that work with the Vercel AI SDK to enable agentic coding capabilities. It gives AI models like Claude the ability to:

- Execute bash commands in a persistent shell
- Read files and list directories
- Create and write files
- Edit existing files with string replacement
- Search for files by pattern
- Search file contents with regex
- Spawn sub-agents for complex tasks
- Track task progress with todos
- Search the web and fetch URLs
- Load skills on-demand via the [Agent Skills](https://agentskills.io) standard

## Installation

```bash
bun add @bashkit ai zod
```

For web tools, also install:
```bash
bun add parallel-web
```

## Quick Start

### With Filesystem Access (Desktop Apps, Local Scripts, Servers)

When you have direct filesystem access, use `LocalSandbox`:

```typescript
import { createAgentTools, createLocalSandbox } from '@bashkit';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs } from 'ai';

// Create a local sandbox (runs directly on your filesystem)
const sandbox = createLocalSandbox({ cwd: '/tmp/workspace' });

// Create tools bound to the sandbox
const tools = createAgentTools(sandbox);

// Use with Vercel AI SDK
const result = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  tools,
  prompt: 'Create a simple Express server in server.js',
  stopWhen: stepCountIs(10),
});

console.log(result.text);

// Cleanup
await sandbox.destroy();
```

### Without Filesystem Access (Web/Serverless Environments)

When you're in a web or serverless environment without filesystem access, use `VercelSandbox` or `E2BSandbox`:

```typescript
import { createAgentTools, createVercelSandbox } from '@bashkit';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText, stepCountIs } from 'ai';

// Create a Vercel sandbox (isolated Firecracker microVM)
const sandbox = createVercelSandbox({
  runtime: 'node22',
  resources: { vcpus: 2 },
});

const tools = createAgentTools(sandbox);

const result = streamText({
  model: anthropic('claude-sonnet-4-5'),
  messages,
  tools,
  stopWhen: stepCountIs(10),
});

// Cleanup
await sandbox.destroy();
```

## Available Tools

### Sandbox-based Tools (from `createAgentTools`)

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

### Web Tools (require `parallel-web` peer dependency)

| Tool | Purpose | Factory |
|------|---------|---------|
| `WebSearch` | Search the web | `createWebSearchTool({ apiKey })` |
| `WebFetch` | Fetch URL and process with AI | `createWebFetchTool({ apiKey, model })` |

## Sandbox Types

### LocalSandbox

Runs commands directly on your filesystem. **Use when you have filesystem access** (desktop apps, local scripts, servers you control).

```typescript
import { createLocalSandbox } from '@bashkit';

const sandbox = createLocalSandbox({ cwd: '/tmp/workspace' });
```

### VercelSandbox

Runs in isolated Firecracker microVMs on Vercel's infrastructure. **Use when you don't have filesystem access** (web apps, serverless functions, browser environments).

```typescript
import { createVercelSandbox } from '@bashkit';

const sandbox = createVercelSandbox({
  runtime: 'node22',
  resources: { vcpus: 2 },
});
```

### E2BSandbox

Runs in E2B's cloud sandboxes. Requires `@e2b/code-interpreter` peer dependency. **Use when you don't have filesystem access** and need E2B's features.

```typescript
import { createE2BSandbox } from '@bashkit';

const sandbox = createE2BSandbox({
  // E2B config
});
```

## Configuration

You can configure tools with security restrictions and limits:

```typescript
const tools = createAgentTools(sandbox, {
  tools: {
    Bash: {
      timeout: 30000,
      blockedCommands: ['rm -rf', 'curl'],
      maxOutputLength: 10000,
    },
    Read: {
      allowedPaths: ['/workspace/**'],
    },
    Write: {
      maxFileSize: 1_000_000, // 1MB limit
    },
  },
  webSearch: {
    apiKey: process.env.PARALLEL_API_KEY,
  },
  webFetch: {
    apiKey: process.env.PARALLEL_API_KEY,
    model: anthropic('claude-haiku-4'),
  },
});
```

### Configuration Options

#### Global Config
- `defaultTimeout` (number): Default timeout for all tools in milliseconds
- `workingDirectory` (string): Default working directory for the sandbox

#### Per-Tool Config
- `timeout` (number): Tool-specific timeout
- `maxFileSize` (number): Maximum file size in bytes (Write)
- `maxOutputLength` (number): Maximum output length (Bash)
- `allowedPaths` (string[]): Restrict file operations to specific paths
- `blockedCommands` (string[]): Block commands containing these strings (Bash)

## Sub-agents with Task Tool

The Task tool spawns new `generateText` calls for complex subtasks:

```typescript
import { createTaskTool } from '@bashkit';

const taskTool = createTaskTool({
  model: anthropic('claude-sonnet-4-5'),
  tools: sandboxTools,
  subagentTypes: {
    research: {
      model: anthropic('claude-haiku-4'), // Cheaper model for research
      systemPrompt: 'You are a research specialist. Find information only.',
      tools: ['Read', 'Grep', 'Glob'], // Limited tools
    },
    coding: {
      systemPrompt: 'You are a coding expert. Write clean code.',
      tools: ['Read', 'Write', 'Edit', 'Bash'],
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

## Context Management

### Conversation Compaction

Automatically summarize conversations when they exceed token limits:

```typescript
import { compactConversation, MODEL_CONTEXT_LIMITS } from '@bashkit';

let compactState = { conversationSummary: '' };

const result = await compactConversation(messages, {
  maxTokens: MODEL_CONTEXT_LIMITS['claude-sonnet-4-5'],
  summarizerModel: anthropic('claude-haiku-4'), // Fast/cheap model
  compactionThreshold: 0.85, // Trigger at 85% usage
  protectRecentMessages: 10, // Keep last 10 messages intact
}, compactState);

messages = result.messages;
compactState = result.state;
```

### Context Status Monitoring

Monitor context usage and inject guidance to prevent agents from rushing:

```typescript
import { getContextStatus, contextNeedsCompaction } from '@bashkit';

const status = getContextStatus(messages, MODEL_CONTEXT_LIMITS['claude-sonnet-4-5']);

if (status.guidance) {
  // Inject into system prompt
  system = `${system}\n\n<context_status>${status.guidance}</context_status>`;
}

if (contextNeedsCompaction(status)) {
  // Trigger compaction
  const compacted = await compactConversation(messages, config, state);
}
```

## Prompt Caching

Enable Anthropic prompt caching to reduce costs on repeated prefixes:

```typescript
import { wrapLanguageModel } from 'ai';
import { anthropicPromptCacheMiddleware } from '@bashkit';

const model = wrapLanguageModel({
  model: anthropic('claude-sonnet-4-5'),
  middleware: anthropicPromptCacheMiddleware,
});

// Check cache stats in result
console.log({
  cacheCreation: result.providerMetadata?.anthropic?.cacheCreationInputTokens,
  cacheRead: result.providerMetadata?.anthropic?.cacheReadInputTokens,
});
```

## Agent Skills

bashkit supports the [Agent Skills](https://agentskills.io) standard - an open format for giving agents new capabilities and expertise. Skills are folders containing a `SKILL.md` file with instructions that agents can load on-demand.

> **Note:** Skill discovery is designed for **LocalSandbox** use cases where the agent has access to the user's filesystem. For cloud sandboxes (VercelSandbox/E2B), you would bundle skills with your app and inject them directly into the system prompt.

### Progressive Disclosure

Skills use progressive disclosure to keep context lean:
1. **At startup**: Only skill metadata (name, description, path) is loaded (~50-100 tokens per skill)
2. **On activation**: Agent reads the full `SKILL.md` via the Read tool when needed

### Discovering Skills

When using LocalSandbox, skills are discovered from:
1. `.skills/` in the project directory (highest priority)
2. `~/.bashkit/skills/` for user-global skills

This allows agents to pick up project-specific skills and user-installed skills automatically.

```typescript
import { discoverSkills, skillsToXml } from '@bashkit';

// Discover skills (metadata only - fast, low context)
const skills = await discoverSkills();

// Or with custom paths
const skills = await discoverSkills({
  paths: ['.skills', '/path/to/shared/skills'],
  cwd: '/my/project',
});
```

### Using Skills with Agents

Inject skill metadata into the system prompt using XML format (recommended for Claude):

```typescript
import { discoverSkills, skillsToXml, createAgentTools, createLocalSandbox } from '@bashkit';

const skills = await discoverSkills();
const sandbox = createLocalSandbox({ cwd: '/tmp/workspace' });
const tools = createAgentTools(sandbox);

const result = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  tools,
  system: `You are a coding assistant.

${skillsToXml(skills)}

When a task matches a skill, use the Read tool to load its full instructions from the location path.`,
  prompt: 'Extract text from invoice.pdf',
  stopWhen: stepCountIs(10),
});

// Agent will call Read({ file_path: "/path/to/.skills/pdf-processing/SKILL.md" })
// when it decides to use the pdf-processing skill
```

### Creating Skills

Create a folder with a `SKILL.md` file:

```
.skills/
└── pdf-processing/
    └── SKILL.md
```

The `SKILL.md` file has YAML frontmatter and markdown instructions:

```markdown
---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, merge documents.
license: MIT
compatibility: Requires poppler-utils
metadata:
  author: my-org
  version: "1.0"
---

# PDF Processing

## When to use this skill
Use when the user needs to work with PDF files...

## How to extract text
1. Use pdftotext for text extraction...
```

**Required fields:**
- `name`: 1-64 chars, lowercase letters, numbers, and hyphens. Must match folder name.
- `description`: 1-1024 chars. Describes when to use this skill.

**Optional fields:**
- `license`: License info
- `compatibility`: Environment requirements
- `metadata`: Arbitrary key-value pairs
- `allowed-tools`: Space-delimited list of pre-approved tools (experimental)

### Using Remote Skills

Fetch complete skill folders from GitHub repositories, including all scripts and resources:

```typescript
import { fetchSkill, fetchSkills, setupAgentEnvironment } from '@bashkit';

// Fetch a complete skill folder from Anthropic's official skills repo
const pdfSkill = await fetchSkill('anthropics/skills/pdf');
// Returns a SkillBundle:
// {
//   name: 'pdf',
//   files: {
//     'SKILL.md': '...',
//     'scripts/extract_text.py': '...',
//     'forms.md': '...',
//     // ... all files in the skill folder
//   }
// }

// Or batch fetch multiple skills
const remoteSkills = await fetchSkills([
  'anthropics/skills/pdf',
  'anthropics/skills/web-research',
]);
// Returns: { 'pdf': SkillBundle, 'web-research': SkillBundle }

// Use with setupAgentEnvironment - writes all files to .skills/
const config = {
  skills: {
    ...remoteSkills,                    // SkillBundles (all files)
    'my-custom': myCustomSkillContent,  // Inline string (just SKILL.md)
  },
};

const { skills } = await setupAgentEnvironment(sandbox, config);
// Creates: .skills/pdf/SKILL.md, .skills/pdf/scripts/*, etc.
```

**GitHub reference format:** `owner/repo/skillName`
- `anthropics/skills/pdf` → fetches all files from `https://github.com/anthropics/skills/tree/main/skills/pdf`

### API Reference

```typescript
// Discover skills from filesystem
discoverSkills(options?: DiscoverSkillsOptions): Promise<SkillMetadata[]>

// Fetch complete skill folders from GitHub
fetchSkill(ref: string): Promise<SkillBundle>
fetchSkills(refs: string[]): Promise<Record<string, SkillBundle>>

// SkillBundle type
interface SkillBundle {
  name: string;
  files: Record<string, string>;  // relative path -> content
}

// Generate XML for system prompts
skillsToXml(skills: SkillMetadata[]): string

// Parse a single SKILL.md file
parseSkillMetadata(content: string, skillPath: string): SkillMetadata
```

## Setting Up Agent Environments

For cloud sandboxes (VercelSandbox/E2B), use `setupAgentEnvironment` to create workspace directories and seed skills.

```typescript
import { 
  setupAgentEnvironment, 
  skillsToXml, 
  createAgentTools, 
  createVercelSandbox 
} from '@bashkit';

// Define your environment config
const config = {
  workspace: {
    notes: 'files/notes/',
    outputs: 'files/outputs/',
  },
  skills: {
    'web-research': `---
name: web-research
description: Research topics using web search and save findings.
---
# Web Research
Use WebSearch to find information...
`,
  },
};

// Create sandbox and set up environment
const sandbox = createVercelSandbox({});
const { skills } = await setupAgentEnvironment(sandbox, config);

// Build prompt using the same config (stays in sync!)
const systemPrompt = `You are a research assistant.

**ENVIRONMENT:**
- Save notes to: ${config.workspace.notes}
- Save outputs to: ${config.workspace.outputs}

${skillsToXml(skills)}
`;

// Create tools and run
const tools = createAgentTools(sandbox);

const result = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  tools,
  system: systemPrompt,
  messages,
});
```

### What setupAgentEnvironment Does

1. **Creates workspace directories** - All paths in `config.workspace` are created
2. **Seeds skills** - Skills in `config.skills` are written to `.skills/` directory
3. **Returns skill metadata** - For use with `skillsToXml()`

### Using with Subagents

Use the same config for subagent prompts:

```typescript
const taskTool = createTaskTool({
  model,
  tools,
  subagentTypes: {
    researcher: {
      systemPrompt: `You are a researcher.
Save findings to: ${config.workspace.notes}`,
      tools: ['WebSearch', 'Write'],
    },
    'report-writer': {
      systemPrompt: `Read from: ${config.workspace.notes}
Save reports to: ${config.workspace.outputs}`,
      tools: ['Read', 'Glob', 'Write'],
    },
  },
});
```

## Sandbox Interface

`bashkit` uses a bring-your-own-sandbox architecture. You can implement custom sandboxes:

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
import type { Sandbox } from '@bashkit';

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
│   ┌─────────────────────────────┐   │
│   │  Vercel AI SDK              │   │
│   │  (streamText/generateText)  │   │
│   └──────────┬──────────────────┘   │
│              │                      │
│   ┌──────────▼──────────────────┐   │
│   │  bashkit Tools              │   │
│   │  (Bash, Read, Write, etc)   │   │
│   └──────────┬──────────────────┘   │
│              │                      │
│   ┌──────────▼──────────────────┐   │
│   │  Sandbox                    │   │
│   │  (Local/Vercel/E2B/Custom)  │   │
│   └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

**Flow:**
1. User sends prompt to AI via Vercel AI SDK
2. AI decides it needs to use a tool (e.g., create a file)
3. Tool receives the call and executes via the Sandbox
4. Result returns to AI, which continues or completes

## Design Principles

1. **Bring Your Own Sandbox**: Start with LocalSandbox for dev, swap in VercelSandbox/E2BSandbox for production
2. **Type-Safe**: Full TypeScript support with proper type inference
3. **Configurable**: Security controls and limits at the tool level
4. **Vercel AI SDK Native**: Uses standard `tool()` format
5. **Composable**: Mix and match tools, utilities, and middleware as needed

## Examples

See the `examples/` directory for complete working examples:

- `basic.ts` - Full example with todos, sub-agents, and prompt caching
- `test-tools.ts` - Testing individual tools
- `test-web-tools.ts` - Web search and fetch examples

## API Reference

### `createAgentTools(sandbox, config?)`

Creates a set of agent tools bound to a sandbox instance.

**Parameters:**
- `sandbox` (Sandbox): Sandbox instance for code execution
- `config` (AgentConfig, optional): Configuration for tools and web tools

**Returns:** Object with tool definitions compatible with Vercel AI SDK

### Sandbox Factories

- `createLocalSandbox(config?)` - Local execution sandbox
- `createVercelSandbox(config?)` - Vercel Firecracker sandbox
- `createE2BSandbox(config?)` - E2B cloud sandbox

### Workflow Tools

- `createTaskTool(config)` - Spawn sub-agents for complex tasks
- `createTodoWriteTool(state, config?, onUpdate?)` - Track task progress
- `createExitPlanModeTool(config?, onPlanSubmit?)` - Exit planning mode

### Utilities

- `compactConversation(messages, config, state)` - Summarize long conversations
- `getContextStatus(messages, maxTokens, config?)` - Monitor context usage
- `pruneMessagesByTokens(messages, config?)` - Remove old messages
- `estimateMessagesTokens(messages)` - Estimate token count

### Skills

- `discoverSkills(options?)` - Discover skills from filesystem (metadata only)
- `skillsToXml(skills)` - Generate XML for system prompts
- `parseSkillMetadata(content, path)` - Parse a SKILL.md file

### Setup

- `setupAgentEnvironment(sandbox, config)` - Set up workspace directories and seed skills

### Middleware

- `anthropicPromptCacheMiddleware` - Enable prompt caching for Anthropic models

## Future Roadmap

The following features are planned for future releases:

### Agent Profiles Loader

Load pre-configured subagent types from JSON/TypeScript configs:

```json
// .bashkit/agents.json
{
  "subagentTypes": {
    "research": {
      "systemPrompt": "You are a research specialist...",
      "tools": ["Read", "Grep", "Glob", "WebSearch"]
    },
    "coding": {
      "systemPrompt": "You are a coding expert...",
      "tools": ["Read", "Write", "Edit", "Bash"]
    }
  }
}
```

Helper function to auto-load profiles:
```typescript
import { createTaskToolWithProfiles } from '@bashkit';

const taskTool = createTaskToolWithProfiles({
  model,
  tools,
  profilesPath: '.bashkit/agents.json', // Auto-loads
});
```

This will make it easy to:
- Share agent configurations across projects
- Standardize agent patterns within teams
- Quickly set up specialized agents for different tasks

## Contributing

Contributions welcome! Please open an issue or PR.

## License

MIT
