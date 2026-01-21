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

const GLOB_DESCRIPTION = `
- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Task tool instead
- It is always better to speculatively perform multiple searches in parallel if they are potentially useful
`;

export function createGlobTool(sandbox: Sandbox, config?: ToolConfig) {
  return tool({
    description: GLOB_DESCRIPTION,
    inputSchema: zodSchema(globInputSchema),
    // Pass SDK options explicitly for proper type inference
    strict: config?.strict,
    needsApproval: config?.needsApproval,
    providerOptions: config?.providerOptions,
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
        // Use -path for patterns with path separators, -name for simple filename patterns
        const findFlag = pattern.includes("/") ? "-path" : "-name";
        // For -path, prepend */ if pattern doesn't start with * to match from searchPath
        const findPattern =
          pattern.includes("/") && !pattern.startsWith("*")
            ? `*/${pattern}`
            : pattern;
        const result = await sandbox.exec(
          `find ${searchPath} -type f ${findFlag} "${findPattern}" 2>/dev/null | head -1000`,
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
