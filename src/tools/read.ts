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

const READ_DESCRIPTION = `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 500 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files)
- Results are returned with line numbers starting at 1
- This tool can only read text files, not binary files (images, PDFs, etc.)
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- It is always better to speculatively read multiple potentially useful files in parallel
- If you read a file that exists but has empty contents you will receive a warning in place of file contents`;

export function createReadTool(sandbox: Sandbox, config?: ToolConfig) {
  return tool({
    description: READ_DESCRIPTION,
    inputSchema: zodSchema(readInputSchema),
    // Pass SDK options explicitly for proper type inference
    strict: config?.strict,
    needsApproval: config?.needsApproval,
    providerOptions: config?.providerOptions,
    execute: async ({
      file_path,
      offset,
      limit,
    }: ReadInput): Promise<ReadOutput> => {
      // Check allowed paths
      if (config?.allowedPaths) {
        const isAllowed = config.allowedPaths.some((allowed) =>
          file_path.startsWith(allowed),
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

        // Check for binary content (contains null bytes early in file)
        const nullByteIndex = content.indexOf("\0");
        if (nullByteIndex !== -1 && nullByteIndex < 1000) {
          const ext = file_path.split(".").pop()?.toLowerCase();
          const binaryExtensions = [
            "pdf",
            "png",
            "jpg",
            "jpeg",
            "gif",
            "zip",
            "tar",
            "gz",
            "exe",
            "bin",
            "so",
            "dylib",
          ];
          if (binaryExtensions.includes(ext || "")) {
            return {
              error: `Cannot read binary file: ${file_path} (file exists, ${content.length} bytes). Use appropriate tools to process ${ext?.toUpperCase()} files (e.g., Python scripts for PDFs).`,
            };
          }
        }

        const allLines = content.split("\n");
        const totalLines = allLines.length;

        // If file is large and no limit specified, require pagination
        const maxLinesWithoutLimit = config?.maxFileSize || 500;
        if (!limit && totalLines > maxLinesWithoutLimit) {
          return {
            error: `File is large (${totalLines} lines). Use 'offset' and 'limit' to read in chunks. Example: offset=1, limit=100 for first 100 lines.`,
          };
        }

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
