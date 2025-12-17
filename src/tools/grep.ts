import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox/interface";
import type { ToolConfig } from "../types";

export interface GrepMatch {
  file: string;
  line_number?: number;
  line: string;
  before_context?: string[];
  after_context?: string[];
}

export interface GrepContentOutput {
  matches: GrepMatch[];
  total_matches: number;
}

export interface GrepFilesOutput {
  files: string[];
  count: number;
}

export interface GrepCountOutput {
  counts: Array<{ file: string; count: number }>;
  total: number;
}

export interface GrepError {
  error: string;
}

export type GrepOutput =
  | GrepContentOutput
  | GrepFilesOutput
  | GrepCountOutput
  | GrepError;

const grepInputSchema = z.object({
  pattern: z.string().describe("The regular expression pattern to search for"),
  path: z
    .string()
    .optional()
    .describe("File or directory to search in (defaults to cwd)"),
  glob: z
    .string()
    .optional()
    .describe('Glob pattern to filter files (e.g. "*.js")'),
  type: z
    .string()
    .optional()
    .describe('File type to search (e.g. "js", "py", "rust")'),
  output_mode: z
    .enum(["content", "files_with_matches", "count"])
    .optional()
    .describe('Output mode: "content", "files_with_matches", or "count"'),
  "-i": z.boolean().optional().describe("Case insensitive search"),
  "-n": z.boolean().optional().describe("Show line numbers (for content mode)"),
  "-B": z.number().optional().describe("Lines to show before each match"),
  "-A": z.number().optional().describe("Lines to show after each match"),
  "-C": z
    .number()
    .optional()
    .describe("Lines to show before and after each match"),
  head_limit: z
    .number()
    .optional()
    .describe("Limit output to first N lines/entries"),
  multiline: z.boolean().optional().describe("Enable multiline mode"),
});

type GrepInput = z.infer<typeof grepInputSchema>;

export function createGrepTool(sandbox: Sandbox, config?: ToolConfig) {
  return tool({
    description:
      "Powerful search tool built on ripgrep with regex support. Use this instead of the grep command.",
    inputSchema: zodSchema(grepInputSchema),
    execute: async (input: GrepInput): Promise<GrepOutput> => {
      const {
        pattern,
        path,
        glob,
        type,
        output_mode = "content",
        "-i": caseInsensitive,
        "-n": showLineNumbers = true,
        "-B": beforeContext,
        "-A": afterContext,
        "-C": context,
        head_limit,
        multiline,
      } = input;

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
        // Build grep/rg command
        const flags: string[] = [];

        if (caseInsensitive) flags.push("-i");
        if (showLineNumbers && output_mode === "content") flags.push("-n");
        if (multiline) flags.push("-U");

        // Context flags
        if (context) {
          flags.push(`-C ${context}`);
        } else {
          if (beforeContext) flags.push(`-B ${beforeContext}`);
          if (afterContext) flags.push(`-A ${afterContext}`);
        }

        // File filtering
        if (glob) flags.push(`--include="${glob}"`);
        if (type) flags.push(`--include="*.${type}"`);

        const flagStr = flags.join(" ");
        const limit = head_limit || 1000;

        let cmd: string;

        if (output_mode === "files_with_matches") {
          cmd = `grep -rl ${flagStr} "${pattern}" ${searchPath} 2>/dev/null | head -${limit}`;

          const result = await sandbox.exec(cmd, { timeout: config?.timeout });
          const files = result.stdout.split("\n").filter(Boolean);

          return {
            files,
            count: files.length,
          };
        } else if (output_mode === "count") {
          cmd = `grep -rc ${flagStr} "${pattern}" ${searchPath} 2>/dev/null | grep -v ':0$' | head -${limit}`;

          const result = await sandbox.exec(cmd, { timeout: config?.timeout });
          const lines = result.stdout.split("\n").filter(Boolean);
          const counts = lines.map((line) => {
            const lastColon = line.lastIndexOf(":");
            return {
              file: line.slice(0, lastColon),
              count: parseInt(line.slice(lastColon + 1), 10),
            };
          });
          const total = counts.reduce((sum, c) => sum + c.count, 0);

          return {
            counts,
            total,
          };
        } else {
          // content mode (default)
          cmd = `grep -rn ${flagStr} "${pattern}" ${searchPath} 2>/dev/null | head -${limit}`;

          const result = await sandbox.exec(cmd, { timeout: config?.timeout });

          if (!result.stdout.trim()) {
            return {
              matches: [],
              total_matches: 0,
            };
          }

          // Parse grep output: file:line_number:content
          const lines = result.stdout.split("\n").filter(Boolean);
          const matches: GrepMatch[] = [];

          for (const line of lines) {
            const colonMatch = line.match(/^(.+?):(\d+)[:|-](.*)$/);
            if (colonMatch) {
              const [, file, lineNum, content] = colonMatch;
              matches.push({
                file,
                line_number: parseInt(lineNum, 10),
                line: content,
              });
            }
          }

          return {
            matches,
            total_matches: matches.length,
          };
        }
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
