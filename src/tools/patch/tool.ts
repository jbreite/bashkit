/**
 * Patch tool — applies patches in Codex apply-patch format.
 *
 * Supports Add, Delete, and Update operations with fuzzy line matching.
 * Complements the Edit tool for multi-hunk and multi-file edits.
 */

import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { Sandbox } from "../../sandbox/interface";
import { shellQuote } from "../../sandbox/shell-quote";
import type { ToolConfig } from "../../types";
import {
  debugEnd,
  debugError,
  debugStart,
  isDebugEnabled,
} from "../../utils/debug";
import { deriveNewContents } from "./apply";
import { parsePatch } from "./parser";
import type { Hunk, PatchError, PatchFileResult, PatchOutput } from "./types";

const patchInputSchema = z.object({
  patch: z.string().describe(
    `The patch to apply in Codex apply-patch format.

Format:
\`\`\`
*** Begin Patch
*** Add File: path/to/new-file.ts
+line 1
+line 2
*** Update File: path/to/existing.ts
 context line
-old line
+new line
*** Delete File: path/to/remove.ts
*** End Patch
\`\`\`

Rules:
- Wrap patch in \`*** Begin Patch\` / \`*** End Patch\`
- Add files: \`*** Add File: <path>\` then \`+\`-prefixed lines
- Delete files: \`*** Delete File: <path>\`
- Update files: \`*** Update File: <path>\` then diff chunks
  - Context lines: space prefix (used for seeking position)
  - Remove lines: \`-\` prefix
  - Add lines: \`+\` prefix
  - Use \`@@\` to start a new chunk within the same file
  - Use \`*** End of File\` to anchor a chunk at file end
- Move/rename: \`*** Move to: <new-path>\` after Update header
- Multiple files in one patch supported`,
  ),
});

const PATCH_DESCRIPTION = `Apply a patch to one or more files using the Codex apply-patch format.

Supports adding new files, deleting files, and updating existing files with context-based diff matching. Uses fuzzy whitespace matching for resilience.

**When to use Patch vs Edit:**
- Use **Edit** for simple single-string replacements in one file
- Use **Patch** for multi-hunk edits, multi-file changes, file additions/deletions, or when you need context-based matching`;

/**
 * A pre-flight-validated operation, ready to apply.
 * Updates carry their derived content so we don't read+derive twice.
 */
type PreparedOp =
  | { kind: "add"; path: string; content: string }
  | { kind: "delete"; path: string }
  | { kind: "modify"; path: string; content: string }
  | { kind: "move"; fromPath: string; toPath: string; content: string };

async function deleteFileWithFallback(
  sandbox: Sandbox,
  path: string,
): Promise<void> {
  if (sandbox.deleteFile) {
    await sandbox.deleteFile(path);
    return;
  }
  const result = await sandbox.exec(`rm -- ${shellQuote(path)}`);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to delete ${path}: ${result.stderr}`);
  }
}

export function createPatchTool(sandbox: Sandbox, config?: ToolConfig) {
  return tool({
    description: PATCH_DESCRIPTION,
    inputSchema: zodSchema(patchInputSchema),
    strict: config?.strict,
    needsApproval: config?.needsApproval,
    providerOptions: config?.providerOptions,
    execute: async ({
      patch,
    }: z.infer<typeof patchInputSchema>): Promise<PatchOutput | PatchError> => {
      const startTime = performance.now();
      const debugId = isDebugEnabled()
        ? debugStart("patch", {
            patchLength: patch.length,
          })
        : "";

      try {
        // Step 1: Parse
        const parsed = parsePatch(patch);

        if (parsed.hunks.length === 0) {
          const error = "Patch contains no operations";
          if (debugId) debugError(debugId, "patch", error);
          return { error };
        }

        // Step 2: Validate paths against allowedPaths
        if (config?.allowedPaths) {
          const pathError = validateAllowedPaths(
            parsed.hunks,
            config.allowedPaths,
          );
          if (pathError) {
            if (debugId) debugError(debugId, "patch", pathError);
            return { error: pathError };
          }
        }

        // Step 3: Pre-flight — validate every hunk and derive new contents
        // before any sandbox writes. This avoids partial application when a
        // mid-patch hunk fails (bad context, missing file, size limit, etc).
        const prepared: PreparedOp[] = [];
        for (const hunk of parsed.hunks) {
          const op = await prepareHunk(sandbox, hunk, config);
          if ("error" in op) {
            if (debugId) debugError(debugId, "patch", op.error);
            return op;
          }
          prepared.push(op.op);
        }

        // Step 4: Apply prepared ops sequentially. By this point parsing,
        // context-matching, and size limits have all passed; only raw I/O
        // errors (disk full, permission denied) can still fail here.
        const files: PatchFileResult[] = [];
        for (const op of prepared) {
          switch (op.kind) {
            case "add":
              await sandbox.writeFile(op.path, op.content);
              files.push({ status: "added", path: op.path });
              break;
            case "delete":
              await deleteFileWithFallback(sandbox, op.path);
              files.push({ status: "deleted", path: op.path });
              break;
            case "modify":
              await sandbox.writeFile(op.path, op.content);
              files.push({ status: "modified", path: op.path });
              break;
            case "move":
              await sandbox.writeFile(op.toPath, op.content);
              await deleteFileWithFallback(sandbox, op.fromPath);
              files.push({ status: "modified", path: op.toPath });
              break;
          }
        }

        const durationMs = Math.round(performance.now() - startTime);
        if (debugId) {
          debugEnd(debugId, "patch", {
            summary: {
              files: files.length,
              operations: files.map((f) => `${f.status}: ${f.path}`),
            },
            duration_ms: durationMs,
          });
        }

        const message =
          files.length === 1
            ? `Successfully patched ${files[0].path}`
            : `Successfully patched ${files.length} files`;

        return { message, files };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (debugId) debugError(debugId, "patch", errorMessage);
        return { error: errorMessage };
      }
    },
  });
}

/**
 * Run pre-flight validation for a single hunk and produce a PreparedOp.
 * On any validation failure, returns `{ error }` and the caller aborts
 * before any writes have happened.
 */
async function prepareHunk(
  sandbox: Sandbox,
  hunk: Hunk,
  config: ToolConfig | undefined,
): Promise<{ op: PreparedOp } | { error: string }> {
  switch (hunk.type) {
    case "add": {
      if (config?.maxFileSize && hunk.content.length > config.maxFileSize) {
        return {
          error: `File too large: ${hunk.path} (${hunk.content.length} bytes, max ${config.maxFileSize})`,
        };
      }
      return { op: { kind: "add", path: hunk.path, content: hunk.content } };
    }

    case "delete": {
      if (!(await sandbox.fileExists(hunk.path))) {
        return { error: `File not found for deletion: ${hunk.path}` };
      }
      return { op: { kind: "delete", path: hunk.path } };
    }

    case "update": {
      if (!(await sandbox.fileExists(hunk.path))) {
        return { error: `File not found: ${hunk.path}` };
      }
      const original = await sandbox.readFile(hunk.path);
      let newContent: string;
      try {
        newContent = deriveNewContents(original, hunk.chunks, hunk.path);
      } catch (e) {
        return {
          error:
            e instanceof Error
              ? e.message
              : `Failed to apply update to ${hunk.path}`,
        };
      }
      if (config?.maxFileSize && newContent.length > config.maxFileSize) {
        return {
          error: `File too large after patch: ${hunk.path} (${newContent.length} bytes, max ${config.maxFileSize})`,
        };
      }
      if (hunk.movePath && hunk.movePath !== hunk.path) {
        if (await sandbox.fileExists(hunk.movePath)) {
          return {
            error: `Move target already exists: ${hunk.movePath}`,
          };
        }
        return {
          op: {
            kind: "move",
            fromPath: hunk.path,
            toPath: hunk.movePath,
            content: newContent,
          },
        };
      }
      return { op: { kind: "modify", path: hunk.path, content: newContent } };
    }
  }
}

function validateAllowedPaths(
  hunks: Hunk[],
  allowedPaths: string[],
): string | null {
  for (const hunk of hunks) {
    const paths = [hunk.path];
    if (hunk.type === "update" && hunk.movePath) {
      paths.push(hunk.movePath);
    }
    for (const p of paths) {
      const isAllowed = allowedPaths.some((allowed) => p.startsWith(allowed));
      if (!isAllowed) {
        return `Path not allowed: ${p}`;
      }
    }
  }
  return null;
}
