import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox/interface";
import type { GrepToolConfig } from "../types";

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
  pattern: z
    .string()
    .describe("The regular expression pattern to search for in file contents"),
  path: z
    .string()
    .optional()
    .describe("File or directory to search in (defaults to cwd)"),
  glob: z
    .string()
    .optional()
    .describe('Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")'),
  type: z
    .string()
    .optional()
    .describe('File type to search (e.g. "js", "py", "rust")'),
  output_mode: z
    .enum(["content", "files_with_matches", "count"])
    .optional()
    .describe(
      'Output mode: "content" shows matching lines, "files_with_matches" shows file paths (default), "count" shows match counts',
    ),
  "-i": z.boolean().optional().describe("Case insensitive search"),
  "-n": z
    .boolean()
    .optional()
    .describe(
      "Show line numbers in output. Requires output_mode: 'content'. Defaults to true.",
    ),
  "-B": z
    .number()
    .optional()
    .describe(
      "Number of lines to show before each match. Requires output_mode: 'content'.",
    ),
  "-A": z
    .number()
    .optional()
    .describe(
      "Number of lines to show after each match. Requires output_mode: 'content'.",
    ),
  "-C": z
    .number()
    .optional()
    .describe(
      "Number of lines to show before and after each match. Requires output_mode: 'content'.",
    ),
  head_limit: z
    .number()
    .optional()
    .describe(
      "Limit output to first N lines/entries. Works across all output modes. Defaults to 0 (unlimited).",
    ),
  offset: z
    .number()
    .optional()
    .describe(
      "Skip first N lines/entries before applying head_limit. Works across all output modes. Defaults to 0.",
    ),
  multiline: z
    .boolean()
    .optional()
    .describe(
      "Enable multiline mode where patterns can span lines (requires ripgrep). Default: false.",
    ),
});

type GrepInput = z.infer<typeof grepInputSchema>;

const GREP_DESCRIPTION = `A powerful content search tool with regex support. Use this instead of running grep commands directly.

**Usage:**
- ALWAYS use Grep for search tasks. NEVER invoke \`grep\` or \`rg\` as a Bash command.
- Supports regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")

**Output modes:**
- "content": Shows matching lines with optional context
- "files_with_matches": Shows only file paths (default)
- "count": Shows match counts per file

**Context options (content mode only):**
- -B: Lines to show before each match
- -A: Lines to show after each match
- -C: Lines to show before and after each match

**Pagination:**
- Use offset to skip results (useful for pagination)
- Use head_limit to limit total results returned

**Note:** Set useRipgrep: true in config for better performance and multiline support (requires ripgrep installed).`;

export function createGrepTool(sandbox: Sandbox, config?: GrepToolConfig) {
  const useRipgrep = config?.useRipgrep ?? false;

  return tool({
    description: GREP_DESCRIPTION,
    inputSchema: zodSchema(grepInputSchema),
    execute: async (input: GrepInput): Promise<GrepOutput> => {
      const {
        pattern,
        path,
        glob,
        type,
        output_mode = "files_with_matches",
        "-i": caseInsensitive,
        "-n": showLineNumbers = true,
        "-B": beforeContext,
        "-A": afterContext,
        "-C": context,
        head_limit,
        offset = 0,
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

      // Multiline only supported with ripgrep
      if (multiline && !useRipgrep) {
        return {
          error:
            "Multiline mode requires ripgrep. Set useRipgrep: true in config.",
        };
      }

      try {
        // Build pagination suffix
        let paginationSuffix = "";
        if (offset > 0) {
          paginationSuffix += ` | tail -n +${offset + 1}`;
        }
        if (head_limit && head_limit > 0) {
          paginationSuffix += ` | head -${head_limit}`;
        }

        let cmd: string;

        if (useRipgrep) {
          // Use ripgrep
          cmd = buildRipgrepCommand({
            pattern,
            searchPath,
            output_mode,
            caseInsensitive,
            showLineNumbers,
            beforeContext,
            afterContext,
            context,
            glob,
            type,
            multiline,
            paginationSuffix,
          });
        } else {
          // Use standard grep
          cmd = buildGrepCommand({
            pattern,
            searchPath,
            output_mode,
            caseInsensitive,
            showLineNumbers,
            beforeContext,
            afterContext,
            context,
            glob,
            type,
            paginationSuffix,
          });
        }

        const result = await sandbox.exec(cmd, { timeout: config?.timeout });

        // Parse output based on mode
        if (output_mode === "files_with_matches") {
          const files = result.stdout.split("\n").filter(Boolean);
          return {
            files,
            count: files.length,
          };
        } else if (output_mode === "count") {
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
          // content mode
          if (!result.stdout.trim()) {
            return {
              matches: [],
              total_matches: 0,
            };
          }

          const lines = result.stdout.split("\n").filter(Boolean);
          const matches: GrepMatch[] = [];

          for (const line of lines) {
            // Match file:line:content or file-line-content (context lines use -)
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

// Helper to build ripgrep command
function buildRipgrepCommand(opts: {
  pattern: string;
  searchPath: string;
  output_mode: string;
  caseInsensitive?: boolean;
  showLineNumbers?: boolean;
  beforeContext?: number;
  afterContext?: number;
  context?: number;
  glob?: string;
  type?: string;
  multiline?: boolean;
  paginationSuffix: string;
}): string {
  const flags: string[] = [];

  if (opts.caseInsensitive) flags.push("-i");
  if (opts.multiline) flags.push("-U", "--multiline-dotall");

  // Context flags (only for content mode)
  if (opts.output_mode === "content") {
    if (opts.showLineNumbers) flags.push("-n");
    if (opts.context) {
      flags.push(`-C ${opts.context}`);
    } else {
      if (opts.beforeContext) flags.push(`-B ${opts.beforeContext}`);
      if (opts.afterContext) flags.push(`-A ${opts.afterContext}`);
    }
  }

  // File filtering using ripgrep syntax
  if (opts.glob) flags.push(`-g "${opts.glob}"`);
  if (opts.type) flags.push(`-t ${opts.type}`);

  const flagStr = flags.join(" ");

  if (opts.output_mode === "files_with_matches") {
    return `rg -l ${flagStr} "${opts.pattern}" ${opts.searchPath} 2>/dev/null${opts.paginationSuffix}`;
  } else if (opts.output_mode === "count") {
    return `rg -c ${flagStr} "${opts.pattern}" ${opts.searchPath} 2>/dev/null${opts.paginationSuffix}`;
  } else {
    return `rg ${flagStr} "${opts.pattern}" ${opts.searchPath} 2>/dev/null${opts.paginationSuffix}`;
  }
}

// Helper to build standard grep command
function buildGrepCommand(opts: {
  pattern: string;
  searchPath: string;
  output_mode: string;
  caseInsensitive?: boolean;
  showLineNumbers?: boolean;
  beforeContext?: number;
  afterContext?: number;
  context?: number;
  glob?: string;
  type?: string;
  paginationSuffix: string;
}): string {
  const flags: string[] = ["-r"]; // recursive

  if (opts.caseInsensitive) flags.push("-i");

  // Context flags (only for content mode)
  if (opts.output_mode === "content") {
    if (opts.showLineNumbers) flags.push("-n");
    if (opts.context) {
      flags.push(`-C ${opts.context}`);
    } else {
      if (opts.beforeContext) flags.push(`-B ${opts.beforeContext}`);
      if (opts.afterContext) flags.push(`-A ${opts.afterContext}`);
    }
  }

  // File filtering using grep syntax
  if (opts.glob) flags.push(`--include="${opts.glob}"`);
  if (opts.type) flags.push(`--include="*.${opts.type}"`);

  const flagStr = flags.join(" ");

  if (opts.output_mode === "files_with_matches") {
    return `grep -l ${flagStr} "${opts.pattern}" ${opts.searchPath} 2>/dev/null${opts.paginationSuffix}`;
  } else if (opts.output_mode === "count") {
    return `grep -c ${flagStr} "${opts.pattern}" ${opts.searchPath} 2>/dev/null | grep -v ':0$'${opts.paginationSuffix}`;
  } else {
    return `grep ${flagStr} "${opts.pattern}" ${opts.searchPath} 2>/dev/null${opts.paginationSuffix}`;
  }
}
