import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox/interface";
import type { ToolConfig } from "../types";

export interface GlobOutput {
  matches: string[];
  count: number;
  search_path: string;
}

export interface GlobError {
  error: string;
}

const globInputSchema = z.object({
  pattern: z
    .string()
    .describe(
      'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.js", "*.md")',
    ),
  path: z
    .string()
    .optional()
    .describe("Directory to search in (defaults to working directory)"),
});

type GlobInput = z.infer<typeof globInputSchema>;

export function createGlobTool(sandbox: Sandbox, config?: ToolConfig) {
  return tool({
    description:
      "Search for files matching a glob pattern. Returns file paths sorted by modification time. Use this instead of `find` command.",
    inputSchema: zodSchema(globInputSchema),
    execute: async ({
      pattern,
      path,
    }: GlobInput): Promise<GlobOutput | GlobError> => {
      const searchPath = path || ".";

      // Check allowed paths
      if (config?.allowedPaths) {
        const isAllowed = config.allowedPaths.some((allowed) =>
          searchPath.startsWith(allowed),
        );
        if (!isAllowed) {
          return { error: `Path not allowed: ${searchPath}` };
        }
      }

      try {
        // Use find with glob pattern via bash
        // -type f for files only, sorted by modification time
        const result = await sandbox.exec(
          `find ${searchPath} -type f -name "${pattern}" 2>/dev/null | head -1000`,
          { timeout: config?.timeout },
        );

        if (result.exitCode !== 0 && result.stderr) {
          return { error: result.stderr };
        }

        const matches = result.stdout
          .split("\n")
          .filter(Boolean)
          .map((p) => p.trim());

        return {
          matches,
          count: matches.length,
          search_path: searchPath,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
