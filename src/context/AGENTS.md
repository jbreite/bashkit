# Context Module

Builds the agent's runtime context: static system prompt assembly (instructions, environment, tool guidance) and dynamic per-step behavior (tool execution gating, output truncation, message-level hints). Bridges discovered project docs and sandbox state into prompt material while layering cross-cutting policies on top of any `ToolSet` without mutating individual tool definitions.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Barrel exports + `ContextLayer` interface, `withContext()`, `applyContextLayers()` |
| `build-context.ts` | `buildSystemContext()` — assembles instructions + environment + tool guidance into one string |
| `instructions.ts` | `discoverInstructions()` — walks CWD→root finding AGENTS.md/CLAUDE.md files |
| `environment.ts` | `collectEnvironment()` + `formatEnvironment()` — cwd/shell/platform/date/git snapshot as XML |
| `tool-guidance.ts` | `buildToolGuidance()` — one-line hint list keyed by registered tool names |
| `execution-policy.ts` | `createExecutionPolicy()` — plan-mode + custom gate layer (`beforeExecute`) |
| `output-policy.ts` | `createOutputPolicy()` — truncation + redirection hints + optional disk stash (`afterExecute`) |
| `prepare-step.ts` | `createPrepareStep()` — composes compaction + context-status + plan-mode hints for AI SDK `prepareStep` |

## Key Exports

- `withContext(tool, toolName, layers)` -- Wraps a single `Tool` preserving generics; first `beforeExecute` rejection wins, `afterExecute` transforms pipe
- `applyContextLayers(tools, layers)` -- Wraps an entire `ToolSet` (no-op if `layers.length === 0`)
- `ContextLayer` -- `{ beforeExecute?, afterExecute? }` with `Record<string, unknown>` params (tool-agnostic)
- `buildSystemContext(sandbox, config?)` -- Returns `{ instructions, environment, toolGuidance, combined, meta }`; designed to be called **once at init** for prompt-cache stability
- `createExecutionPolicy(planModeState, config?)` -- Blocks `["Bash", "Write", "Edit"]` by default when plan mode is active
- `createOutputPolicy(config?)` -- Defaults: `maxOutputLength: 30000`, `redirectionThreshold: 20000`, uses `middleTruncate`
- `createPrepareStep(config)` -- Returns a `PrepareStepFunction<ToolSet>`; **never touches `system`** (prompt cache)
- `discoverInstructions`, `collectEnvironment`, `formatEnvironment`, `buildToolGuidance` -- individual section builders

## Architecture

**Two distinct concerns, one module**:

1. **Static prompt assembly** (`build-context.ts` → `instructions.ts` + `environment.ts` + `tool-guidance.ts`): runs once at agent init. Output goes into `streamText({ system })` and must stay stable across turns for Anthropic prompt caching.
2. **Dynamic per-step layers** (`index.ts` wrappers → `execution-policy.ts` + `output-policy.ts`, plus `prepare-step.ts`): intercept every tool call or message list. Can be async, can short-circuit, can transform.

**Internal dependency graph**:
```
index.ts ──────── re-exports everything + ContextLayer/withContext/applyContextLayers
  ↑
build-context.ts ──→ instructions.ts
                 ──→ environment.ts
                 ──→ tool-guidance.ts
execution-policy.ts ──→ index.ts (ContextLayer type only)
output-policy.ts    ──→ index.ts (ContextLayer type only) + ../utils/helpers (middleTruncate)
prepare-step.ts     ──→ ../utils/compact-conversation + ../utils/context-status
```

**Layer composition** (`withContext` in `index.ts:74`): `beforeExecute` hooks run sequentially, first `{ error }` return short-circuits; `afterExecute` hooks pipe the result through in order. Tools without `execute` (client-rendered / deferred) pass through untouched.

**Instruction discovery** (`instructions.ts:52`): walks upward from `sandbox.workingDirectory` collecting dirs until a root marker (`.git` by default) is hit, then reverses so root-level docs come first and local docs win on specificity. Per dir, first matching filename from `filenames` wins. Global instruction file (if configured) is prepended. 32KB cap — only the last source is marked `truncated`.

**Output policy** (`output-policy.ts:189`): extracts text from common result shapes (`stdout`, `content`, or serialized JSON), and if over `redirectionThreshold` optionally stashes full text to disk (`/tmp/.bashkit/tool-output` by default), truncates via `middleTruncate`, then injects `_hint` back into the result. Hint priority: `buildHint` callback → `hints` map → built-in per-tool hints → generic fallback.

**prepareStep pipeline** (`prepare-step.ts:50`): (1) run auto-compaction if configured, (2) check context status → inject `<context_status>` as a user message, (3) inject `<plan_mode>` user message when plan mode active, (4) let consumer `extend` callback augment. **Never sets `system`** — comment at `prepare-step.ts:39` is load-bearing.

## Design Patterns

- **Chain of Responsibility** — `withContext` runs layers in order until one rejects (before) / all transform (after)
- **Strategy** — `OutputPolicyConfig.truncate` and `buildHint` are pluggable
- **Decorator** — `withContext` wraps tools without changing their `Tool<PARAMETERS, RESULT>` generic (type-preserving)
- **Gate + Transform split** — `beforeExecute` returns `{ error }` to reject, `afterExecute` returns a new result to transform. Keeps gates pure and transforms side-effect-aware
- **Stable-system / dynamic-messages** — system prompt is frozen at init (cache friendly), per-step dynamism lives in `messages` via `prepareStep`

## Integration Points

**Depends on**:
- `../sandbox/interface` — `Sandbox` type for `discoverInstructions`/`collectEnvironment`/`stashOutput`
- `../tools/enter-plan-mode` — `PlanModeState` type (execution-policy + prepare-step)
- `../utils/helpers` — `middleTruncate` (output-policy)
- `../utils/compact-conversation`, `../utils/context-status` — prepare-step pipeline
- `ai` — `Tool`, `ToolSet`, `ModelMessage`, `PrepareStepFunction`, `PrepareStepResult`

**Used by**:
- `../tools/index.ts` — `createAgentTools()` imports `withContext`, `applyContextLayers`, `createExecutionPolicy`, `createOutputPolicy` to auto-wire layers from `AgentConfig`
- `../types.ts` — imports `ContextLayer`, `ExecutionPolicyConfig`, `OutputPolicyConfig` to type `AgentConfig.context`

**Exported from** `src/index.ts:130`: all types (`ContextLayer`, `ExecutionPolicyConfig`, `OutputPolicyConfig`, `StashOutputConfig`, `InstructionDiscoveryConfig`, `DiscoveredInstructions`, `EnvironmentContext`, `EnvironmentContextConfig`, `ToolGuidanceConfig`, `SystemContextConfig`, `SystemContext`, `PrepareStepConfig`) and all functions (`withContext`, `applyContextLayers`, `createExecutionPolicy`, `createOutputPolicy`, `discoverInstructions`, `collectEnvironment`, `formatEnvironment`, `buildToolGuidance`, `buildSystemContext`, `createPrepareStep`).

## Common Modifications

### Add a new context layer
1. Create `my-layer.ts` exporting a factory that returns `ContextLayer` (from `./index`)
2. Implement `beforeExecute` (gate) and/or `afterExecute` (transform); remember `afterExecute` must return the result
3. Re-export from `index.ts`
4. If it should auto-wire, add to `AgentConfig` in `../types.ts` and hook into `../tools/index.ts` `createAgentTools`

**Gotchas**: params/result are `Record<string, unknown>` — layers are tool-agnostic. Don't assume tool-specific fields without a `toolName` check. `beforeExecute` order matters (first rejection wins); `afterExecute` order matters (pipe).

### Add a new system prompt section
1. Create builder in a new file with `XConfig` + `buildX(config)` (sync) or `collectX(sandbox, config)` + `formatX(data)` (async, needs sandbox)
2. Add to `SystemContextConfig` in `build-context.ts:15`
3. Wire into `buildSystemContext` parallel `Promise.all` and append to `sections` array
4. Export from `index.ts`

**Gotchas**: sections must be deterministic across init calls (prompt cache). Never pull dynamic state (git status, message counts) into a system section — put those in `prepare-step.ts` as user messages.

### Change output truncation behavior for a tool
1. If globally: pass custom `truncate` to `createOutputPolicy`
2. If per-tool: add entry to `BUILT_IN_HINTS` in `output-policy.ts:58` or pass `hints`/`buildHint` via config
3. If shape-specific: extend `extractText` in `output-policy.ts:127` to recognize new result shapes

**Gotchas**: `excludeTools` skips truncation entirely. Truncated output is re-injected into the original field (`stdout` or `content`); for JSON-serialized results, it lands in `_truncated` + `_hint`.

### Add a new instruction source
1. Extend `DiscoveredInstructions["sources"][].scope` union in `instructions.ts:19`
2. Add collection logic in `discoverInstructions` before or after the upward walk (see `globalPath` at `instructions.ts:102`)
3. Decide merge order (current convention: most specific last)

**Gotchas**: 32KB cap applies to the concatenated output; new sources compete for the same budget. Only the last source gets `truncated: true` flagged.

### Extend `prepareStep` without breaking built-ins
Pass a `PrepareStepFunction` as `config.extend` to `createPrepareStep`. It runs last and its return is merged into the final `PrepareStepResult`. Do not set `system` in your extension — it breaks Anthropic prompt caching.

## Testing

**Test files** in `tests/context/`:
- `build-context.test.ts` (434 lines) — system prompt assembly, section enabling/disabling, combined output
- `execution-policy.test.ts` (145 lines) — plan-mode blocking, custom predicates
- `output-policy.test.ts` (520 lines) — truncation, hints, stash-to-disk, custom builders
- `prepare-step.test.ts` (196 lines) — compaction, context-status injection, plan-mode hint, extend composition
- `with-context.test.ts` (346 lines) — layer wrapping, gate short-circuit, transform pipe, no-execute passthrough
- `parallel.test.ts` (175 lines) — layer isolation under concurrent tool calls
- `integration.test.ts` (273 lines) — end-to-end with real `ToolSet` + sandbox

**Run tests**:
```bash
bun run test tests/context/
```

**Gaps**: no dedicated tests for `instructions.ts` or `environment.ts`/`tool-guidance.ts` as units (coverage is indirect through `build-context.test.ts`). Stash-output disk path collision under extreme parallelism is covered by the `stashCounter` but not explicitly tested beyond `parallel.test.ts`.

## Breaking Change Risks

- `ContextLayer` signature — changing `beforeExecute`/`afterExecute` params or return types breaks every registered layer downstream
- `SystemContext` shape — consumers read `combined` + individual sections; removing fields breaks prompt builders
- `buildSystemContext` cache discipline — any change that makes its output non-deterministic across calls silently breaks Anthropic prompt caching for every consumer
- `prepare-step.ts` touching `system` — guarded by comment, but worth a code review flag on any edit
