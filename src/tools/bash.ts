import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox/interface";
import type { ToolConfig } from "../types";

export interface BashOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
  interrupted: boolean;
  duration_ms: number;
}

export interface BashError {
  error: string;
}

const bashInputSchema = z.object({
  command: z.string().describe("The command to execute"),
  timeout: z
    .number()
    .optional()
    .describe("Optional timeout in milliseconds (max 600000)"),
  description: z
    .string()
    .optional()
    .describe(
      "Clear, concise description of what this command does in 5-10 words"
    ),
  run_in_background: z
    .boolean()
    .optional()
    .describe("Set to true to run this command in the background"),
});

type BashInput = z.infer<typeof bashInputSchema>;

const BASH_DESCRIPTION = `Executes bash commands in a persistent shell session with optional timeout and background execution.

**Important guidelines:**
- Always quote file paths containing spaces with double quotes (e.g., cd "/path/with spaces")
- Avoid using search commands like \`find\` and \`grep\` - use the Glob and Grep tools instead
- Avoid using \`cat\`, \`head\`, \`tail\` - use the Read tool instead
- When issuing multiple commands, use \`;\` or \`&&\` to separate them (not newlines)
- If output exceeds 30000 characters, it will be truncated
- Default timeout is 2 minutes; maximum is 10 minutes`;

export function createBashTool(sandbox: Sandbox, config?: ToolConfig) {
  const maxOutputLength = config?.maxOutputLength ?? 30000;
  const defaultTimeout = config?.timeout ?? 120000;

  return tool({
    description: BASH_DESCRIPTION,
    inputSchema: zodSchema(bashInputSchema),
    execute: async ({
      command,
      timeout,
      description: _description,
      run_in_background: _run_in_background,
    }: BashInput): Promise<BashOutput | BashError> => {
      // Check for blocked commands
      if (config?.blockedCommands) {
        for (const blocked of config.blockedCommands) {
          if (command.includes(blocked)) {
            return {
              error: `Command blocked: contains '${blocked}'`,
            };
          }
        }
      }

      try {
        const effectiveTimeout = Math.min(timeout ?? defaultTimeout, 600000);

        // Note: run_in_background would need sandbox support for background processes
        // For now, we execute synchronously
        const result = await sandbox.exec(command, {
          timeout: effectiveTimeout,
        });

        // Truncate output if needed
        let stdout = result.stdout;
        let stderr = result.stderr;

        if (stdout.length > maxOutputLength) {
          stdout =
            stdout.slice(0, maxOutputLength) +
            `\n[output truncated, ${
              stdout.length - maxOutputLength
            } chars omitted]`;
        }
        if (stderr.length > maxOutputLength) {
          stderr =
            stderr.slice(0, maxOutputLength) +
            `\n[output truncated, ${
              stderr.length - maxOutputLength
            } chars omitted]`;
        }

        return {
          stdout,
          stderr,
          exit_code: result.exitCode,
          interrupted: result.interrupted,
          duration_ms: result.durationMs,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
