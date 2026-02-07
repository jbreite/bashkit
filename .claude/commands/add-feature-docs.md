---
description: Generate or update AGENTS.md documentation for a source folder
argument-hint: <folder-path, e.g., src/tools>
---

# Generate Folder Documentation

Generate or update the `AGENTS.md` file for the folder: `$ARGUMENTS`

## Process

1. **Explore the folder**: Read every file in `$ARGUMENTS/` to understand:
   - What each file does
   - Key exports (functions, types, interfaces, classes)
   - Design patterns used
   - Dependencies on other modules (imports from outside the folder)
   - How other modules depend on this one (search for imports of this folder across src/)

2. **Check for existing AGENTS.md**: If `$ARGUMENTS/AGENTS.md` already exists, read it and update it rather than replacing from scratch. Preserve any manually-added context that is still accurate.

3. **Check related test files**: Look in `tests/` for test files that mirror this folder structure. Note which files have tests and which do not.

4. **Generate the AGENTS.md** following this template:

~~~markdown
# <Module Name>

<One paragraph summary: what this module does, why it exists, and its role in the bashkit system.>

## Files

| File | Purpose |
|------|---------|
| `filename.ts` | One-line description of what this file does |

## Key Exports

List the most important public exports that other modules or consumers use:

- `functionName(params)` -- What it does
- `InterfaceName` -- What it represents

## Architecture

Describe how the files in this folder relate to each other. Include:
- Internal dependency graph (which files import from which)
- Key data flows
- Important abstractions

## Design Patterns

Document specific patterns used in this module with brief rationale:
- **Pattern name** -- How it is applied and why

## Integration Points

How this module connects to the rest of bashkit:
- **Depends on**: Which other `src/` folders this module imports from
- **Used by**: Which other `src/` folders import from this module
- **Exported from**: Whether/how it surfaces in `src/index.ts`

## Common Modifications

### <Task: e.g., "Adding a new tool">
1. Step-by-step instructions
2. Files to modify
3. Gotchas to watch out for

## Testing

- List relevant test files in `tests/`
- Note any gaps in test coverage
- Describe how to run tests for this module: `bun test tests/<path>`
~~~

## Guidelines

- Write for an AI coding agent that needs to understand and modify this module
- Be precise about file names and function signatures
- Include actual type signatures where they clarify the API
- Keep descriptions factual and concise -- no marketing language
- Use the `.nullable()` convention note where relevant to tool schemas
- Note any breaking change risks for public API surface
- Do NOT include code examples that duplicate the root AGENTS.md (which covers consumer-facing usage)
- Focus on INTERNAL architecture, not external API usage
- Keep total length under 200 lines -- this should be a quick-reference, not a novel
