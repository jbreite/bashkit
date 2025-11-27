import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox/interface";
import type { ToolConfig } from "../types";

export interface ReadTextOutput {
  type: "text";
  content: string;
  lines: Array<{ line_number: number; content: string }>;
  total_lines: number;
}

export interface ReadDirectoryOutput {
  type: "directory";
  entries: string[];
  count: number;
}

export interface ReadError {
  error: string;
}

export type ReadOutput = ReadTextOutput | ReadDirectoryOutput | ReadError;

const readInputSchema = z.object({
  file_path: z.string().describe("Absolute path to file or directory"),
  offset: z
    .number()
    .optional()
    .describe("Line number to start reading from (1-indexed)"),
  limit: z.number().optional().describe("Maximum number of lines to read"),
});

type ReadInput = z.infer<typeof readInputSchema>;

export function createReadTool(sandbox: Sandbox, config?: ToolConfig) {
  if (config?.enabled === false) return null;

  return tool({
    description:
      "Read the contents of a file or list directory entries. For text files, returns numbered lines with total line count. For directories, returns file/folder names. Use this instead of `cat`, `head`, or `tail` commands.",
    inputSchema: zodSchema(readInputSchema),
    execute: async ({
      file_path,
      offset,
      limit,
    }: ReadInput): Promise<ReadOutput> => {
      // Check allowed paths
      if (config?.allowedPaths) {
        const isAllowed = config.allowedPaths.some((allowed) =>
          file_path.startsWith(allowed)
        );
        if (!isAllowed) {
          return { error: `Path not allowed: ${file_path}` };
        }
      }

      try {
        const exists = await sandbox.fileExists(file_path);
        if (!exists) {
          return { error: `Path not found: ${file_path}` };
        }

        const isDir = await sandbox.isDirectory(file_path);
        if (isDir) {
          const entries = await sandbox.readDir(file_path);
          return {
            type: "directory",
            entries,
            count: entries.length,
          };
        }

        // It's a file
        const content = await sandbox.readFile(file_path);
        const allLines = content.split("\n");
        const totalLines = allLines.length;

        // Apply offset and limit
        const startLine = offset ? offset - 1 : 0;
        const endLine = limit ? startLine + limit : allLines.length;
        const selectedLines = allLines.slice(startLine, endLine);

        const lines = selectedLines.map((line, i) => ({
          line_number: startLine + i + 1,
          content: line,
        }));

        return {
          type: "text",
          content: selectedLines.join("\n"),
          lines,
          total_lines: totalLines,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
