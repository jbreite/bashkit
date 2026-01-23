import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox/interface";
import type { ToolConfig } from "../types";
import {
  debugEnd,
  debugError,
  debugStart,
  isDebugEnabled,
} from "../utils/debug";

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
    .nullable()
    .describe("Optional timeout in milliseconds (max 600000)"),
  description: z
    .string()
    .nullable()
    .describe(
      "Clear, concise description of what this command does in 5-10 words",
    ),
  run_in_background: z
    .boolean()
    .nullable()
    .describe("Set to true to run this command in the background"),
});

type BashInput = z.infer<typeof bashInputSchema>;

const BASH_DESCRIPTION = `Executes a bash command in a persistent shell session with optional timeout.

IMPORTANT: For file operations (reading, writing, editing, searching, finding files) - use the specialized tools instead of bash commands.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`ls\` to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use \`ls foo\` to check that "foo" exists

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., cd "/path/with spaces")
   - Examples of proper quoting:
     - cd "/Users/name/My Documents" (correct)
     - cd /Users/name/My Documents (incorrect - will fail)
   - After ensuring proper quoting, execute the command

Usage notes:
  - The command argument is required
  - You can specify an optional timeout in milliseconds (max 600000ms / 10 minutes). Default is 120000ms (2 minutes).
  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words
  - If the output exceeds 30000 characters, output will be truncated
  - Avoid using \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands. Instead, use dedicated tools:
    - File search: Use Glob (NOT find or ls)
    - Content search: Use Grep (NOT grep or rg)
    - Read files: Use Read (NOT cat/head/tail)
    - Edit files: Use Edit (NOT sed/awk)
    - Write files: Use Write (NOT echo >/cat <<EOF)
  - When issuing multiple commands:
    - If commands are independent, make multiple Bash tool calls in parallel
    - If commands depend on each other, use '&&' to chain them (e.g., \`git add . && git commit -m "message"\`)
    - Use ';' only when you need sequential execution but don't care if earlier commands fail
    - DO NOT use newlines to separate commands
  - Try to maintain your current working directory by using absolute paths and avoiding \`cd\``;

export function createBashTool(sandbox: Sandbox, config?: ToolConfig) {
  const maxOutputLength = config?.maxOutputLength ?? 30000;
  const defaultTimeout = config?.timeout ?? 120000;

  return tool({
    description: BASH_DESCRIPTION,
    inputSchema: zodSchema(bashInputSchema),
    // Pass SDK options explicitly for proper type inference
    strict: config?.strict,
    needsApproval: config?.needsApproval,
    providerOptions: config?.providerOptions,
    execute: async ({
      command,
      timeout,
      description: _description,
      run_in_background: _run_in_background,
    }: BashInput): Promise<BashOutput | BashError> => {
      const startTime = performance.now();
      const debugId = isDebugEnabled()
        ? debugStart("bash", {
            command:
              command.length > 200 ? `${command.slice(0, 200)}...` : command,
            timeout,
          })
        : "";

      // Check for blocked commands
      if (config?.blockedCommands) {
        for (const blocked of config.blockedCommands) {
          if (command.includes(blocked)) {
            const error = `Command blocked: contains '${blocked}'`;
            if (debugId) debugError(debugId, "bash", error);
            return { error };
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

        const durationMs = Math.round(performance.now() - startTime);

        if (debugId) {
          debugEnd(debugId, "bash", {
            summary: {
              exitCode: result.exitCode,
              stdoutLen: result.stdout.length,
              stderrLen: result.stderr.length,
              interrupted: result.interrupted,
            },
            duration_ms: durationMs,
          });
        }

        return {
          stdout,
          stderr,
          exit_code: result.exitCode,
          interrupted: result.interrupted,
          duration_ms: result.durationMs,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (debugId) debugError(debugId, "bash", errorMessage);
        return { error: errorMessage };
      }
    },
  });
}
