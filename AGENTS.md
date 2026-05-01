# BashKit — Contributor Guide

> Agentic coding tools for the Vercel AI SDK.

**Tech Stack**: TypeScript · Bun · Vercel AI SDK · Zod
**Package**: `bashkit` ([npm](https://www.npmjs.com/package/bashkit) · [GitHub](https://github.com/jbreite/bashkit))

This file is for **agents and humans working ON bashkit**. For consumer-facing API usage (how to *use* bashkit in an app), see `README.md`. For folder-specific internals, see the `AGENTS.md` inside each `src/*` directory.

> **Before editing anything inside `src/<folder>/`, read `src/<folder>/AGENTS.md` first.** Every folder has one. They document internal file layout, key exports, data flows, and per-task modification steps. This root file intentionally does not duplicate them — if you only read this file, you are missing half the picture.

---

## Core Principles

These apply to every PR, no exceptions:

1. **Fully typed.** No `any`. Use `unknown` at untrusted boundaries and narrow with guards. Public APIs must have explicit return types — don't rely on inference for exports. Tool input/output shapes live in Zod schemas + exported TypeScript interfaces that stay in sync.
2. **Testable and tested.** Every public export has a test. Tests mirror `src/` layout in `tests/`. Bug fixes include a regression test. If a change is hard to test, refactor until it isn't.
3. **Typecheck and lint before pushing.** `bun run typecheck && bun run check && bun run test` must be green locally. CI will reject otherwise.
4. **Return errors, don't throw.** Tools return `{ error: string }` objects so the model can see the failure. Only sandbox-layer code throws, and tools catch it.
5. **Config-driven, not flag-driven.** Optional features are enabled by the *presence* of a config object (e.g. `webSearch: { apiKey }`), not by boolean flags. Defaults live in factories via `config?.field ?? default`.
6. **No breaking changes without a major bump.** See the Breaking Change Surface section below before touching the `Sandbox` interface, tool schemas, tool names, `ContextLayer`, or `createAgentTools` return shape.
7. **Docs live next to code.** When you change files in a folder, update that folder's `AGENTS.md` in the same PR.

---

## References

If a `references/` directory exists at the project root, search it for implementation patterns when building new features. It is gitignored — contributors symlink or clone repos locally.

- `references/codex` — OpenAI Codex CLI. Tool designs, agent loop, sandboxing patterns.
- `references/pi-mono` — pi-mono monorepo. See `packages/coding-agent` for agent loop patterns.

---

## Code Organization

```
src/
├── sandbox/       # Execution environments (Local, Vercel, E2B) — src/sandbox/AGENTS.md
├── tools/         # Tool implementations — src/tools/AGENTS.md
├── context/       # Prompt assembly + tool execution layers — src/context/AGENTS.md
├── cache/         # Tool result caching (LRU, Redis) — src/cache/AGENTS.md
├── middleware/    # AI SDK language model middleware — src/middleware/AGENTS.md
├── utils/         # Budget, compaction, context status, helpers — src/utils/AGENTS.md
├── skills/        # Agent Skills standard — src/skills/AGENTS.md
├── setup/         # Agent environment setup (sandbox bootstrapping) — src/setup/AGENTS.md
├── cli/           # CLI initialization — src/cli/AGENTS.md
├── types.ts       # AgentConfig, ToolConfig, DEFAULT_CONFIG
└── index.ts       # Barrel re-exports (public API surface)
```

**Each folder has its own `AGENTS.md`** with file listings, exports, internal architecture, and per-task modification guides.

### AGENTS.md Conventions (enforced in CI)

- Every folder under `src/` **must** have an `AGENTS.md`. When you add a new folder, add one.
- Every `AGENTS.md` (except the root) **must** have a co-located `CLAUDE.md` symlink pointing to it.
- Automation: `bun run link-agents` creates missing symlinks; `bun run check:agents` fails CI if any are missing.
- When you **add, remove, or significantly change** files in a folder, update that folder's `AGENTS.md` in the same PR. Stale folder docs are worse than no docs.

---

## Development Workflow

### Build & Typecheck

```bash
bun install
bun run typecheck   # ALWAYS run before bun run build
bun run build       # Bun bundles to dist/index.js + tsc emits .d.ts
```

**Script names are exact — no hyphens.** It's `typecheck`, not `type-check`. Running the wrong name will just error with "Script not found". See `package.json` for the full list.

**Critical**: `bun run build` does **not** fail on type errors during bundling. Run `bun run typecheck` first or type regressions will ship silently.

### Full Pre-Push Check

Before pushing, run all four gates locally — CI will reject otherwise:

```bash
bun run typecheck && bun run check && bun run test && bun run check:agents
```

Exact script names (from `package.json`): `typecheck`, `build`, `test`, `test:watch`, `test:coverage`, `format`, `format:check`, `lint`, `lint:check`, `check`, `check:ci`, `link-agents`, `check:agents`.

### Tests

Use Vitest via `bun run test` — **not** `bun test` (which runs Bun's built-in runner and will miss our suite).

```bash
bun run test                              # all tests
bun run test tests/utils/budget.test.ts   # single file
bun run test:watch                        # watch mode
bun run test:coverage                     # with coverage
```

Tests live in `tests/<folder>/` mirroring `src/<folder>/`. Examples in `/examples/` serve as integration tests and require sandbox/API-key env vars.

**Everything non-trivial ships with tests.** New tools, new context layers, new utilities, new sandbox methods — all get unit tests before merging. Bug fixes include a regression test that would have caught the bug. If you can't easily test something, that's a signal the abstraction is wrong, not a reason to skip the test.

### Lint & Format

Biome handles both:

```bash
bun run check       # lint + format, auto-fix
bun run check:ci    # lint + format, no writes (CI gate)
bun run format      # format only
bun run lint        # lint only
```

Run `bun run check` before pushing. CI runs `check:ci`, `typecheck`, `test`, and `check:agents` — all four must pass.

### Commits & PRs

- Commits are small, imperative, sentence-case: `Add budget tracking`, `Refactor AskUser tool to deferred client-rendered model`, `Fix lint and typecheck CI failures`.
- One logical change per commit. Keep refactors separate from feature work.
- PR titles follow the same style as commits. PR descriptions should explain *why*, link relevant issues, and call out any public API changes.
- CI gates: `typecheck`, `check:ci` (Biome), `test`, `check:agents`. All four must pass before merge.

### Local Iteration Loop

Use `LocalSandbox` (Bun APIs, no network) for fast iteration. Swap to `VercelSandbox` / `E2BSandbox` when you need to verify production behavior.

```bash
bun examples/test-tools.ts                # direct tool calls, no AI
ANTHROPIC_API_KEY=xxx bun examples/basic.ts  # full agentic loop
```

---

## Code Conventions

### Naming

| Element | Convention | Examples |
|---|---|---|
| Tool names | PascalCase | `Bash`, `Read`, `WebSearch` |
| Factories | `createX` | `createBashTool`, `createLocalSandbox` |
| Output types | `XOutput` | `BashOutput`, `ReadOutput` |
| Error types | `XError` | `BashError`, `ReadError` |
| Config types | `XConfig` | `ToolConfig`, `AgentConfig` |
| Files | kebab-case | `bash.ts`, `anthropic-cache.ts` |

### Type Organization

- **Input schemas**: colocated with tool implementation (`src/tools/bash.ts` defines `bashInputSchema`).
- **Output/Error types**: exported from the tool file; tools return `Output | Error` unions.
- **Config types**: centralized in `src/types.ts`.
- **Error handling**: tools **return** `{ error: string }` objects — they do not throw. Sandbox methods may throw; tools catch them.

### `.nullable()` over `.optional()` for tool inputs

All optional tool parameters use `z.nullable()`, **not** `z.optional()`. OpenAI structured outputs require every property in the `required` array; `.optional()` removes them and breaks OpenAI. `.nullable()` keeps them required but allows `null`, and works on both Anthropic and OpenAI.

```ts
const schema = z.object({
  timeout: z.number().nullable(),
  replace_all: z.boolean().nullable(),
});

// Destructuring defaults (= value) only fire on undefined, NOT null.
// Always use ?? for defaults with nullable fields:
const { timeout, replace_all: rawReplaceAll } = input;
const effectiveTimeout = timeout ?? 120000;
const replaceAll = rawReplaceAll ?? false;
```

### Configuration Pattern

Tool factories accept an optional `ToolConfig` and merge with defaults inline:

```ts
export function createBashTool(sandbox: Sandbox, config?: ToolConfig) {
  const timeout = config?.timeout ?? 120000;
  // ...
}
```

Optional features (WebSearch, WebFetch, cache, budget, context layers) are enabled by **config presence** in `createAgentTools` — don't gate them on feature flags.

---

## Core Abstractions

### Sandbox Interface

All tools depend on `Sandbox` from `src/sandbox/interface.ts`, not concrete implementations. Adding a method is a breaking change for every implementer.

```ts
interface Sandbox {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  fileExists(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  destroy(): Promise<void>;
  readonly id?: string;   // for cloud reconnection
  rgPath?: string;        // set by ensureSandboxTools
}
```

`createVercelSandbox()` and `createE2BSandbox()` are **async** and auto-run `ensureSandboxTools` to install ripgrep so `Grep` works immediately. `createLocalSandbox()` is sync.

### Context Layer

`src/context/` provides two separate concerns:

1. **Static system prompt assembly** (`buildSystemContext`) — discovers `AGENTS.md` / `CLAUDE.md` files, collects environment info (cwd, git branch, platform), builds tool guidance. Called **once at init**, must stay stable across turns for Anthropic prompt caching.
2. **Dynamic per-step layers** (`withContext`, `applyContextLayers`, `createExecutionPolicy`, `createOutputPolicy`) — intercept every tool call (`beforeExecute` gate, `afterExecute` transform). `createPrepareStep` composes compaction + context-status + plan-mode hints into an AI SDK `prepareStep` callback.

Never mutate `system` from `prepareStep` — it will break prompt caching. Dynamic hints go in `messages` as user content.

### Tool Composition

`createAgentTools(sandbox, config)` is the single entry point that wires tools + cache + budget + context layers from a config object. Everything else is either internal or a lower-level primitive.

---

## Component Interactions

```
User code → Vercel AI SDK → Tool (wrapped w/ context layers + cache)
                               ↓
                            Sandbox interface
                               ↓
              ┌────────────────┼────────────────┐
              ↓                ↓                ↓
         LocalSandbox    VercelSandbox      E2BSandbox
              ↓                ↓                ↓
           Bun APIs      Firecracker VM     E2B service
```

---

## Dependencies

**Required peer deps**: `ai` ^5.0.0, `zod` ^4.1.8.

**Optional peer deps** — users pick their execution environment:
- `@vercel/sandbox` ^1.0.0 — Vercel Firecracker isolation
- `@e2b/code-interpreter` ^1.0.0 — E2B hosted execution
- `parallel-web` ^1.0.0 — WebSearch / WebFetch backend

All deps are marked **external** at build time so consumers don't get a duplicated `ai`/`zod` bundle.

---

## Breaking Change Surface

Anything in this list requires a **major version bump**:

1. **`Sandbox` interface** (`src/sandbox/interface.ts`) — adding methods breaks every implementer.
2. **Tool input schemas** — AI models see these in prompts; removing or renaming fields breaks live integrations.
3. **Tool output/error shapes** — consumers pattern-match on them.
4. **Tool names** — they appear verbatim in prompts ("use the Bash tool").
5. **`ContextLayer` signature** (`src/context/index.ts`) — changes ripple through every custom layer downstream.
6. **`SystemContext` shape** (`src/context/build-context.ts`) — consumers read individual sections.
7. **`createAgentTools` return shape** — `AgentToolsResult` is a public contract.

Safe in minor/patch:
- Adding new optional config fields
- Adding new tools or sandbox implementations
- Internal refactors that preserve public API
- Bug fixes

---

## Security Reminders

The `Bash` tool executes arbitrary commands inside the sandbox — that's the whole point, but it means production deployments **must**:

- Run inside a real sandbox (Vercel or E2B), not LocalSandbox.
- Set `blockedCommands` + `timeout` on `Bash`.
- Set `allowedPaths` on `Read` / `Write` / `Edit`.
- Set `maxFileSize` on `Write`.
- Never expose the raw agent loop to untrusted users without an additional auth layer.

See `src/tools/AGENTS.md` for per-tool config details.

---

## Common Implementation Tasks

| Task | Where to start |
|---|---|
| Add a new tool | `src/tools/AGENTS.md` → "Common Modifications" |
| Add a new sandbox | `src/sandbox/AGENTS.md` → "Common Modifications" |
| Add middleware | `src/middleware/AGENTS.md` → "Common Modifications" |
| Add a cache backend | `src/cache/AGENTS.md` → "Common Modifications" |
| Add a context layer or prompt section | `src/context/AGENTS.md` → "Common Modifications" |
| Add a skill source | `src/skills/AGENTS.md` → "Common Modifications" |
| Add a config field | Define in `src/types.ts`, consume in the relevant factory via `config?.yourField ?? default` |
