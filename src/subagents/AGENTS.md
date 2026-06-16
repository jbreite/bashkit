# Subagents Module

Foundation for controller-managed subagents. This module owns identity, path resolution, profile resolution, tool filtering, lifecycle status, mailbox records, subagent event contracts, stores, runners, controller orchestration, runtime event bridging, and guardrail policies.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Shared public contracts for subagents, profiles, controller requests/results, runners, stores, events, and policies |
| `identity.ts` | Generated subagent IDs |
| `path.ts` | Task-name normalization and relative path resolution |
| `status.ts` | Status helpers and terminal-state checks |
| `profiles.ts` | Profile registry factory and profile resolution |
| `profile-descriptions.ts` | Model-visible profile description generation |
| `tool-filter.ts` | Tool allowlist/denylist filtering |
| `context-inheritance.ts` | Parent-to-child message inheritance for `none`, `all`, and bounded recent-turn policies |
| `tool-surface.ts` | Profile-scoped child tool surface construction with Codemode quarantine |
| `transcripts.ts` | Compact terminal result and transcript reference helpers |
| `ai-sdk-runner.ts` | Default in-process AI SDK runner for one-shot child agent execution |
| `registry.ts` | In-memory identity and path registry factory |
| `store.ts` | Store factory for in-memory metadata, events, and mailbox records |
| `events.ts` | Subagent event sink factory, helpers, and runtime event bridge |
| `mailbox.ts` | Mailbox helpers |
| `runner.ts` | Runner capability helpers and fake test runner utilities |
| `execution-limits.ts` | Active/total/depth/mailbox/wait limit policy |
| `cost-control.ts` | Budget-backed policy checks |
| `controller.ts` | Subagent controller orchestration |
| `index.ts` | Barrel exports |

## Architecture

`createSubagentController` owns orchestration through closure state. It resolves profiles, reserves identity, checks guardrails, writes store records, emits subagent events, optionally emits normalized runtime events, invokes lifecycle hooks, and delegates actual child execution to a `SubagentRunner`.

The default foundation does not put subagent methods on `Sandbox`. Child agents use sandbox-backed tools through their runner/tool surface.

`createAiSdkSubagentRunner` is the default in-process runner. It builds child messages from the profile context policy, constructs a profile-scoped tool surface, calls AI SDK `generateText`, reports usage/tool events through runner callbacks, and returns compact terminal results with result/transcript references. It does not maintain durable paused JavaScript execution or follow-up turns.

## Design Rules

- Keep tool schemas out of this module. Model-facing tools adapt to these core contracts.
- Return `{ error: string }` objects at controller/tool boundaries instead of throwing for runtime failures.
- Use generated IDs as canonical storage identity. Path-like `task_name` values are model-facing references.
- Keep records JSON-serializable unless a type explicitly represents live runtime configuration.
- Avoid `any`; use `unknown`, narrow types, and explicit interfaces.
- Prefer factory functions that return typed plain objects over classes.
- Prefer small pure helpers where possible so controller behavior is easy to test with fake runners.

## Common Modifications

### Add a new controller capability

1. Add request/result types in `types.ts`.
2. Implement orchestration in `controller.ts`.
3. Persist necessary state through `store.ts`.
4. Emit a typed event in `events.ts` if host UIs should observe it.
5. Add focused tests in `tests/subagents/`.

### Add a new profile field

1. Add it to profile input and resolved profile types.
2. Resolve defaults in `profiles.ts`.
3. Include model-visible text in `profile-descriptions.ts` when it helps routing.
4. Add tests for defaulting and override behavior.

### Add a new guardrail

1. Add policy input and resolved policy fields in `types.ts`.
2. Implement the check in `execution-limits.ts` or `cost-control.ts`.
3. Call it from `controller.ts` before expensive runner work starts.
4. Test rejection and reservation cleanup.

### Change child execution behavior

1. Update `ai-sdk-runner.ts` only for model execution and callback routing.
2. Update `tool-surface.ts` only for profile-scoped tool/Codemode exposure.
3. Update `context-inheritance.ts` only for parent message inheritance policy.
4. Keep full transcripts out of `SubagentRunResult`; return references or compact summaries instead.
5. Add focused tests in `tests/subagents/`.
