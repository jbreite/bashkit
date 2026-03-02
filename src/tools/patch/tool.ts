/**
 * Patch tool — applies patches in Codex apply-patch format.
 *
 * Supports Add, Delete, and Update operations with fuzzy line matching.
 * Complements the Edit tool for multi-hunk and multi-file edits.
 */

import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { Sandbox } from "../../sandbox/interface";
import type { ToolConfig } from "../../types";
import {
  debugEnd,
  debugError,
  debugStart,
  isDebugEnabled,
} from "../../utils/debug";
import { deriveNewContents } from "./apply";
import { parsePatch } from "./parser";
import type { PatchError, PatchFileResult, PatchOutput } from "./types";

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
        // Step 1: Parse the patch
        const parsed = parsePatch(patch);

        if (parsed.hunks.length === 0) {
          const error = "Patch contains no operations";
          if (debugId) debugError(debugId, "patch", error);
          return { error };
        }

        // Step 2: Validate all paths against allowedPaths
        if (config?.allowedPaths) {
          for (const hunk of parsed.hunks) {
            const paths = [hunk.path];
            if (hunk.type === "update" && hunk.movePath) {
              paths.push(hunk.movePath);
            }
            for (const p of paths) {
              const isAllowed = config.allowedPaths.some((allowed) =>
                p.startsWith(allowed),
              );
              if (!isAllowed) {
                const error = `Path not allowed: ${p}`;
                if (debugId) debugError(debugId, "patch", error);
                return { error };
              }
            }
          }
        }

        // Step 3: Apply operations sequentially (non-atomic, like Codex)
        const files: PatchFileResult[] = [];

        for (const hunk of parsed.hunks) {
          switch (hunk.type) {
            case "add": {
              // Check file size limit
              if (
                config?.maxFileSize &&
                hunk.content.length > config.maxFileSize
              ) {
                const error = `File too large: ${hunk.path} (${hunk.content.length} bytes, max ${config.maxFileSize})`;
                if (debugId) debugError(debugId, "patch", error);
                return { error };
              }
              await sandbox.writeFile(hunk.path, hunk.content);
              files.push({ status: "added", path: hunk.path });
              break;
            }

            case "delete": {
              const exists = await sandbox.fileExists(hunk.path);
              if (!exists) {
                const error = `File not found for deletion: ${hunk.path}`;
                if (debugId) debugError(debugId, "patch", error);
                return { error };
              }
              await sandbox.deleteFile(hunk.path);
              files.push({ status: "deleted", path: hunk.path });
              break;
            }

            case "update": {
              const exists = await sandbox.fileExists(hunk.path);
              if (!exists) {
                const error = `File not found: ${hunk.path}`;
                if (debugId) debugError(debugId, "patch", error);
                return { error };
              }

              const originalContent = await sandbox.readFile(hunk.path);
              const newContent = deriveNewContents(
                originalContent,
                hunk.chunks,
                hunk.path,
              );

              // Check file size limit
              if (
                config?.maxFileSize &&
                newContent.length > config.maxFileSize
              ) {
                const error = `File too large after patch: ${hunk.path} (${newContent.length} bytes, max ${config.maxFileSize})`;
                if (debugId) debugError(debugId, "patch", error);
                return { error };
              }

              if (hunk.movePath) {
                // Write to new path, delete old
                await sandbox.writeFile(hunk.movePath, newContent);
                await sandbox.deleteFile(hunk.path);
                files.push({ status: "modified", path: hunk.movePath });
              } else {
                await sandbox.writeFile(hunk.path, newContent);
                files.push({ status: "modified", path: hunk.path });
              }
              break;
            }
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
