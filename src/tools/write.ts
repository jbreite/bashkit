import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox/interface";
import type { ToolConfig } from "../types";

export interface WriteOutput {
  message: string;
  bytes_written: number;
  file_path: string;
}

export interface WriteError {
  error: string;
}

const writeInputSchema = z.object({
  file_path: z.string().describe("Path to the file to write"),
  content: z.string().describe("Content to write to the file"),
});

type WriteInput = z.infer<typeof writeInputSchema>;

const WRITE_DESCRIPTION = `Writes content to a file on the filesystem.

**Important guidelines:**
- This tool will overwrite existing files at the provided path
- If modifying an existing file, you MUST use the Read tool first to read the file's contents
- ALWAYS prefer editing existing files over creating new ones
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- The file_path must be an absolute path, not relative

**When to use Write vs Edit:**
- Use Write for creating new files or completely replacing file contents
- Use Edit for making targeted changes to existing files (preferred for modifications)`;

export function createWriteTool(sandbox: Sandbox, config?: ToolConfig) {
  return tool({
    description: WRITE_DESCRIPTION,
    inputSchema: zodSchema(writeInputSchema),
    execute: async ({
      file_path,
      content,
    }: WriteInput): Promise<WriteOutput | WriteError> => {
      // Check file size
      const byteLength = Buffer.byteLength(content, "utf-8");
      if (config?.maxFileSize && byteLength > config.maxFileSize) {
        return {
          error: `File content exceeds maximum size of ${config.maxFileSize} bytes (got ${byteLength})`,
        };
      }

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
        await sandbox.writeFile(file_path, content);
        return {
          message: `Successfully wrote to ${file_path}`,
          bytes_written: byteLength,
          file_path,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
