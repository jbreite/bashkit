# Changelog

## Unreleased

### Breaking

- `createAgentTools` now has a binary coding surface: configure `codemode` to expose Codemode as the parent coding tool, or omit `codemode` to expose direct BashKit tools.
- Removed the legacy `Task` tool. Use `SpawnAgent` plus `WaitAgent`.
- Removed the legacy `TodoWrite` tool. Use `UpdatePlan`.

### Added

- Added controller-backed subagent tools and host-facing control panel state.
- Added profile-scoped subagent policies for tool allowlists, denied-tool behavior, Codemode exposure, context inheritance, and cost/depth/concurrency limits.
- Added JSON-safe subagent profile loading helpers: `loadSubagentProfilesFromObject`, `loadSubagentProfilesFromJson`, and `loadSubagentProfilesFromFile`.
- Added normalized runtime events for tool execution, plan updates, approvals, file changes, command output, and agent lifecycle snapshots.

### Migration

- Replace one-shot `Task` flows with `SpawnAgent({ task, task_name })` followed by `WaitAgent({ agent })`.
- Replace `TodoWrite` with `UpdatePlan`.
- When adopting Codemode, move direct tool policy into Codemode `includeTools` / `excludeTools` and subagent profile policies.
