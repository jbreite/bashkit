import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox/interface";
import type { GrepToolConfig } from "../types";
import {
  debugEnd,
  debugError,
  debugStart,
  isDebugEnabled,
} from "../utils/debug";

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
      "Enable multiline mode where patterns can span lines. Default: false.",
    ),
});

type GrepInput = z.infer<typeof grepInputSchema>;

const GREP_DESCRIPTION = `A powerful content search tool built on ripgrep with regex support.

**Usage:**
- ALWAYS use Grep for search tasks. NEVER invoke \`grep\` or \`rg\` as a Bash command.
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
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
- Use head_limit to limit total results returned`;

// Ripgrep JSON output types
interface RgMessage {
  type: "begin" | "match" | "end" | "context" | "summary";
  data: RgMatchData | RgContextData | RgBeginData | RgEndData | RgSummaryData;
}

interface RgMatchData {
  path: { text: string };
  lines: { text: string };
  line_number: number;
  submatches: Array<{ match: { text: string }; start: number; end: number }>;
}

interface RgContextData {
  path: { text: string };
  lines: { text: string };
  line_number: number;
}

interface RgBeginData {
  path: { text: string };
}

interface RgEndData {
  path: { text: string };
  stats: { matches: number };
}

interface RgSummaryData {
  stats: { matches: number };
}

export function createGrepTool(sandbox: Sandbox, config?: GrepToolConfig) {
  return tool({
    description: GREP_DESCRIPTION,
    inputSchema: zodSchema(grepInputSchema),
    strict: config?.strict,
    needsApproval: config?.needsApproval,
    providerOptions: config?.providerOptions,
    execute: async (input: GrepInput): Promise<GrepOutput> => {
      const {
        pattern,
        path,
        glob,
        type,
        output_mode = "files_with_matches",
        "-i": caseInsensitive,
        "-B": beforeContext,
        "-A": afterContext,
        "-C": context,
        head_limit,
        offset = 0,
        multiline,
      } = input;

      const searchPath = path || ".";
      const startTime = performance.now();
      const debugId = isDebugEnabled()
        ? debugStart("grep", {
            pattern,
            path: searchPath,
            output_mode,
            glob,
            type,
            caseInsensitive,
            multiline,
          })
        : "";

      // Check allowed paths
      if (config?.allowedPaths) {
        const isAllowed = config.allowedPaths.some((allowed) =>
          searchPath.startsWith(allowed),
        );
        if (!isAllowed) {
          const error = `Path not allowed: ${searchPath}`;
          if (debugId) debugError(debugId, "grep", error);
          return { error };
        }
      }

      try {
        // Use sandbox's ripgrep path (set by ensureSandboxTools or default for local)
        if (!sandbox.rgPath) {
          const error =
            "Ripgrep not available. Call ensureSandboxTools(sandbox) before using Grep with remote sandboxes.";
          if (debugId) debugError(debugId, "grep", error);
          return { error };
        }

        const cmd = buildRipgrepCommand({
          rgPath: sandbox.rgPath,
          pattern,
          searchPath,
          output_mode,
          caseInsensitive,
          beforeContext,
          afterContext,
          context,
          glob,
          type,
          multiline,
        });

        const result = await sandbox.exec(cmd, { timeout: config?.timeout });

        const durationMs = Math.round(performance.now() - startTime);

        // Parse output based on mode
        let output: GrepOutput;
        if (output_mode === "files_with_matches") {
          output = parseFilesOutput(result.stdout);
          if (debugId) {
            debugEnd(debugId, "grep", {
              summary: {
                fileCount: (output as GrepFilesOutput).count,
                exitCode: result.exitCode,
              },
              duration_ms: durationMs,
            });
          }
        } else if (output_mode === "count") {
          output = parseCountOutput(result.stdout);
          if (debugId) {
            debugEnd(debugId, "grep", {
              summary: {
                total: (output as GrepCountOutput).total,
                exitCode: result.exitCode,
              },
              duration_ms: durationMs,
            });
          }
        } else {
          output = parseContentOutput(result.stdout, head_limit, offset);
          if (debugId) {
            debugEnd(debugId, "grep", {
              summary: {
                matchCount: (output as GrepContentOutput).total_matches,
                exitCode: result.exitCode,
              },
              duration_ms: durationMs,
            });
          }
        }
        return output;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (debugId) debugError(debugId, "grep", errorMessage);
        return { error: errorMessage };
      }
    },
  });
}

function buildRipgrepCommand(opts: {
  rgPath: string;
  pattern: string;
  searchPath: string;
  output_mode: string;
  caseInsensitive?: boolean;
  beforeContext?: number;
  afterContext?: number;
  context?: number;
  glob?: string;
  type?: string;
  multiline?: boolean;
}): string {
  const flags: string[] = ["--json"]; // Always use JSON output for reliable parsing

  if (opts.caseInsensitive) flags.push("-i");
  if (opts.multiline) flags.push("-U", "--multiline-dotall");

  // Context flags (only for content mode)
  if (opts.output_mode === "content") {
    if (opts.context) {
      flags.push(`-C ${opts.context}`);
    } else {
      if (opts.beforeContext) flags.push(`-B ${opts.beforeContext}`);
      if (opts.afterContext) flags.push(`-A ${opts.afterContext}`);
    }
  }

  // File filtering
  if (opts.glob) flags.push(`-g "${opts.glob}"`);
  if (opts.type) flags.push(`-t ${opts.type}`);

  const flagStr = flags.join(" ");

  return `${opts.rgPath} ${flagStr} "${opts.pattern}" ${opts.searchPath} 2>/dev/null`;
}

function parseFilesOutput(stdout: string): GrepFilesOutput {
  const files = new Set<string>();

  for (const line of stdout.split("\n").filter(Boolean)) {
    try {
      const msg: RgMessage = JSON.parse(line);
      if (msg.type === "begin") {
        const data = msg.data as RgBeginData;
        files.add(data.path.text);
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return {
    files: Array.from(files),
    count: files.size,
  };
}

function parseCountOutput(stdout: string): GrepCountOutput {
  const counts: Map<string, number> = new Map();

  for (const line of stdout.split("\n").filter(Boolean)) {
    try {
      const msg: RgMessage = JSON.parse(line);
      if (msg.type === "end") {
        const data = msg.data as RgEndData;
        counts.set(data.path.text, data.stats.matches);
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  const countsArray = Array.from(counts.entries()).map(([file, count]) => ({
    file,
    count,
  }));
  const total = countsArray.reduce((sum, c) => sum + c.count, 0);

  return {
    counts: countsArray,
    total,
  };
}

interface ContextLine {
  line_number: number;
  text: string;
}

interface ParsedMatch {
  file: string;
  line_number: number;
  line: string;
  before_context: string[];
  after_context: string[];
}

function parseContentOutput(
  stdout: string,
  head_limit?: number,
  offset: number = 0,
): GrepContentOutput {
  // Parse all messages, grouped by file, preserving context line numbers
  const fileData: Map<
    string,
    {
      matches: Array<{ line_number: number; text: string }>;
      contexts: ContextLine[];
    }
  > = new Map();

  for (const line of stdout.split("\n").filter(Boolean)) {
    try {
      const msg: RgMessage = JSON.parse(line);
      if (msg.type === "begin") {
        const data = msg.data as RgBeginData;
        fileData.set(data.path.text, { matches: [], contexts: [] });
      } else if (msg.type === "context") {
        const data = msg.data as RgContextData;
        const fd = fileData.get(data.path.text);
        if (fd) {
          fd.contexts.push({
            line_number: data.line_number,
            text: data.lines.text.replace(/\n$/, ""),
          });
        }
      } else if (msg.type === "match") {
        const data = msg.data as RgMatchData;
        const fd = fileData.get(data.path.text);
        if (fd) {
          fd.matches.push({
            line_number: data.line_number,
            text: data.lines.text.replace(/\n$/, ""),
          });
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  // Process each file to assign context lines to matches based on line numbers
  const allMatches: ParsedMatch[] = [];

  for (const [file, { matches, contexts }] of fileData) {
    // Sort matches and contexts by line number
    matches.sort((a, b) => a.line_number - b.line_number);
    contexts.sort((a, b) => a.line_number - b.line_number);

    // Assign each context line to exactly one match based on proximity
    // This prevents double-assignment when matches are close together
    const matchContexts: Map<number, { before: string[]; after: string[] }> =
      new Map();
    for (const match of matches) {
      matchContexts.set(match.line_number, { before: [], after: [] });
    }

    for (const ctx of contexts) {
      // Find which match this context line belongs to
      let bestMatch: { line_number: number; text: string } | null = null;
      let bestDistance = Infinity;
      let isBefore = false;

      for (const match of matches) {
        const distance = Math.abs(ctx.line_number - match.line_number);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestMatch = match;
          isBefore = ctx.line_number < match.line_number;
        }
      }

      if (bestMatch) {
        const mc = matchContexts.get(bestMatch.line_number);
        if (mc) {
          if (isBefore) {
            mc.before.push(ctx.text);
          } else {
            mc.after.push(ctx.text);
          }
        }
      }
    }

    // Build the parsed matches
    for (const match of matches) {
      const mc = matchContexts.get(match.line_number);
      allMatches.push({
        file,
        line_number: match.line_number,
        line: match.text,
        before_context: mc?.before ?? [],
        after_context: mc?.after ?? [],
      });
    }
  }

  // Convert to output format, only including context if present
  const grepMatches: GrepMatch[] = allMatches.map((m) => ({
    file: m.file,
    line_number: m.line_number,
    line: m.line,
    before_context: m.before_context.length > 0 ? m.before_context : undefined,
    after_context: m.after_context.length > 0 ? m.after_context : undefined,
  }));

  // Apply pagination
  let result = grepMatches;
  if (offset > 0) {
    result = result.slice(offset);
  }
  if (head_limit && head_limit > 0) {
    result = result.slice(0, head_limit);
  }

  return {
    matches: result,
    total_matches: result.length,
  };
}
