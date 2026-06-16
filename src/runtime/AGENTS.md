# Runtime Module

Host-facing runtime primitives for building Codex-like agent experiences on top of BashKit without making BashKit an app server. This module owns normalized event contracts, event sinks, canonical plan state, approval lifecycle contracts, and snapshot reducers.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Shared JSON, runtime event, approval, file change, command output, and tool lifecycle contracts |
| `events.ts` | Subscribable runtime event sink factory and emit helpers |
| `plan.ts` | Canonical Codex-style plan state, stats, and update helpers |
| `approvals.ts` | Approval request/result helpers and lifecycle event constructors |
| `snapshots.ts` | Reducers that project event streams into plan/progress/change snapshots |
| `index.ts` | Barrel exports |

## Architecture

`RuntimeEventSink` is a small host-facing event stream. It records and publishes typed JSON-safe `RuntimeEvent` objects but does not decide where they go. Hosts can forward events to React state, WebSockets, databases, logs, or queues.

`PlanState` is canonical for progress tracking. It follows Codex `update_plan` semantics: an optional explanation plus plan items with `step` and `status`. Runtime state should not depend on legacy todo-list fields such as `activeForm`.

## Design Rules

- Keep this module host-agnostic. Do not add HTTP servers, WebSocket servers, databases, auth, or queue implementations here.
- Use serializable event records so events can cross process and service boundaries.
- Prefer factory functions and pure reducers over classes.
- Keep event payloads typed and explicit. Use `JsonObject` only for genuinely open metadata.
- Avoid importing from `tools/` to prevent runtime/tool cycles. Tools may import runtime primitives.
- Return `{ error: string }` only at model/tool boundaries; pure helpers can return typed values.

## Common Modifications

### Add a new runtime event

1. Add a specific event interface and union member in `types.ts`.
2. Add helper construction logic in the module closest to the source of the event.
3. Update `snapshots.ts` if host UIs should derive state from the event.
4. Add focused tests in `tests/runtime/`.

### Add a new snapshot projection

1. Define the snapshot type in `types.ts` or `snapshots.ts`.
2. Implement a pure reducer in `snapshots.ts`.
3. Test multiple-event ordering, empty streams, and irrelevant-event filtering.
