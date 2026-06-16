# Subagent Control Tools

Model-facing tools for supervising controller-managed subagents.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Barrel exports and `createSubagentControlTools` tool-set factory |
| `types.ts` | Shared tool config and output types |
| `spawn-agent.ts` | `SpawnAgent` adapter |
| `list-agents.ts` | `ListAgents` adapter |
| `send-message.ts` | `SendMessage` adapter |
| `followup-task.ts` | `FollowupTask` adapter |
| `wait-agent.ts` | `WaitAgent` adapter |
| `interrupt-agent.ts` | `InterruptAgent` adapter |

## Architecture

These files are thin adapters over `src/subagents/`. They do not own orchestration, state, profiles, budget, or lifecycle behavior. They parse model-facing inputs, apply nullable defaults with `??`, call `SubagentController`, and return compact structured results.

## Design Rules

- Keep orchestration in `src/subagents/controller.ts`.
- Use nullable schema fields for optional model inputs.
- Return `{ error: string }` for controller/tool failures.
- Keep outputs compact; do not include full child transcripts.
- Prefer factory functions and typed plain objects, not classes.
- Keep tool names PascalCase.

## Common Modifications

### Add a control tool

1. Add shared output/input types in `types.ts` when needed.
2. Add a single adapter file with a `createXTool(controller, config?)` factory.
3. Export it from `index.ts`.
4. Add focused tests under `tests/tools/subagents/`.

