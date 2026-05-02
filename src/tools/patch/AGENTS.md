# Patch Tool

The Patch tool applies file edits in OpenAI Codex's [`apply-patch`](https://github.com/openai/codex/tree/main/codex-rs/apply-patch) format. It complements `Edit` (single-string find/replace) with multi-hunk, multi-file, and rename/delete operations using fuzzy context-line matching.

This folder is a faithful port of `codex-rs/apply-patch`. Keep parser/applier behavior in lockstep with the upstream Rust implementation when fixing bugs — the test names in `tests/tools/patch.test.ts` reference Codex test IDs to make this easier.

## Files

| File | Purpose |
|------|---------|
| `tool.ts` | AI SDK `tool()` definition: parses, pre-flights, applies. Entry point. |
| `parser.ts` | Parses the apply-patch text format into `ParsedPatch` (Add/Delete/Update hunks). |
| `apply.ts` | Computes and applies replacements for Update hunks (`deriveNewContents`). |
| `seek-sequence.ts` | Four-tier fuzzy line matcher (exact → trimEnd → trim → unicode). |
| `types.ts` | Hunk/chunk/output/error types and `PatchParseError` / `PatchApplicationError`. |
| `index.ts` | Re-exports `createPatchTool` and the public types. |

## Key Exports

- `createPatchTool(sandbox, config?)` — factory producing the AI SDK tool.
- `parsePatch(input: string): ParsedPatch` — pure parser (used by tests and other consumers).
- `parseUpdateFileChunk(...)` — exposed for unit tests of the chunk-level grammar.
- `deriveNewContents(original, chunks, path): string` — pure applier, no I/O.
- `seekSequence(lines, pattern, start, eof)` / `normalizeUnicode(s)` — matching primitives.
- Types: `PatchOutput`, `PatchError`, `PatchFileResult`, `Hunk`, `UpdateFileChunk`, `ParsedPatch`.

## Architecture

```
patch text
   │
   ▼
parsePatch ──────► ParsedPatch (Hunk[])
                          │
                          ▼
                  ┌── pre-flight (per hunk) ──┐
                  │  • allowedPaths check     │
                  │  • Update: read + derive  │
                  │  • Delete: fileExists     │
                  │  • Add: maxFileSize       │
                  │  • Move: target collision │
                  └────────────┬──────────────┘
                               │ all pass?
                               ▼
                    apply prepared ops
                  (writeFile / deleteFile)
```

Pre-flight runs **before** any sandbox writes. If a single hunk fails — bad context, missing file, size limit, move-target collision — the tool returns `{ error }` and the filesystem is unchanged. This isn't transactional atomicity (we can't roll back I/O after writes start), but it eliminates the common failure mode of "hunk 3/5 fails, hunks 1–2 already on disk."

The applier (`deriveNewContents`) is pure — it takes original content + chunks and returns new content as a string. All I/O lives in `tool.ts`.

### Sandbox method fallbacks

`Sandbox.deleteFile` and `Sandbox.rename` are optional on the interface. When a custom sandbox doesn't implement them, the tool falls back to `sandbox.exec("rm -- ...")` / `mv -- ...`, with paths quoted via `src/sandbox/shell-quote.ts`. Built-in sandboxes (Local, Vercel, E2B) always implement them, so the fallback is only relevant for third-party `Sandbox` implementers.

## Common Modifications

### Adding a new hunk type

1. Extend the `Hunk` union in `types.ts`.
2. Teach `parser.ts:parseOneHunk` to recognize the header.
3. Add a `case` to `tool.ts:prepareHunk` (validation + derive content) and to the apply switch in `tool.ts:execute`.
4. Add tests mirroring an existing hunk type in `tests/tools/patch.test.ts`.

### Tuning the fuzzy matcher

`seek-sequence.ts` runs four passes globally (exact → trimEnd → trim → unicode). Adding a tier means appending another `for (let i = searchStart; i <= maxIdx; i++)` pass. Keep the order: cheaper/stricter first. Update `normalizeUnicode` if you add new typographic mappings.

### Changing the patch format

The patch format is part of the public LLM contract — the tool description and the `patch` field's `.describe(...)` string both feed into the prompt. Format changes are breaking for any agent that learned the old format from a cached system prompt. Coordinate with a major version bump.

## Testing

`tests/tools/patch.test.ts` (63 tests) covers parser, chunk grammar, seek-sequence, unicode normalization, applier, and the tool-level integration path. Test names that reference `Codex: test_xxx` mirror the upstream Rust tests — keep them in sync.

When adding a new pre-flight check, add a test that asserts **no files were modified** when the check fires (use `sandbox.getFiles()` to snapshot pre/post).
