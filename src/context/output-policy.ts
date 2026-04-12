import type { Sandbox } from "../sandbox/interface";
import { middleTruncate } from "../utils/helpers";
import type { ContextLayer } from "./index";

/**
 * Configuration for stashing full output to disk before truncating.
 */
export interface StashOutputConfig {
  /** Sandbox for writing files */
  sandbox: Sandbox;
  /** Base directory for stashed files. Default: '/tmp/.bashkit/tool-output' */
  dir?: string;
  /** Tools that get disk stash. Others just truncate without saving. */
  tools: string[];
  /**
   * Custom file path per tool. Return undefined for default path.
   * Receives the result object so it can extract tool-specific fields.
   */
  pathFor?: (
    toolName: string,
    params: Record<string, unknown>,
    result: Record<string, unknown>,
  ) => string | undefined;
}

export interface OutputPolicyConfig {
  /** Max characters before truncation. Default: 30000 */
  maxOutputLength?: number;
  /** Max characters before suggesting tool redirection. Default: 20000 */
  redirectionThreshold?: number;
  /** Tools whose output should never be truncated */
  excludeTools?: string[];
  /** Custom truncation function. Defaults to middleTruncate. */
  truncate?: (text: string, maxLength: number) => string;
  /** Simple per-tool hint overrides. Merged with built-in defaults. */
  hints?: Record<string, string>;
  /**
   * Full control callback for building redirection hints.
   * Receives the raw result object for extracting tool-specific fields.
   * Return string to override, undefined to fall through to hints map / defaults.
   */
  buildHint?: (
    toolName: string,
    params: Record<string, unknown>,
    originalLength: number,
    result: Record<string, unknown>,
  ) => string | undefined;
  /** Opt-in disk stash for full output before truncating. */
  stashOutput?: StashOutputConfig;
}

/** Rough line estimate from character count */
function estimateLines(charCount: number): number {
  return Math.max(1, Math.round(charCount / 80));
}

/** Built-in per-tool redirection hints */
const BUILT_IN_HINTS: Record<string, (originalLength: number) => string> = {
  Bash: (len) =>
    `Output truncated (${len} chars, ~${estimateLines(len)} lines). ` +
    `To see specific parts, re-run with | head, | tail, or | grep, ` +
    `or use Read to examine any output files.`,

  Grep: (len) =>
    `Results truncated (${len} chars). ` +
    `Use head_limit and offset parameters to paginate, ` +
    `or narrow your pattern/glob to reduce results.`,

  Read: (len) =>
    `File content truncated (${len} chars, ~${estimateLines(len)} lines). ` +
    `Use offset and limit parameters to read specific sections.`,
};

function defaultHint(len: number): string {
  return (
    `Output truncated (${len} chars). ` +
    `Use Read, Grep, or Bash with targeted commands to access specific parts.`
  );
}

/**
 * Build a redirection hint for a truncated tool result.
 *
 * Priority: buildHint callback > hints map > built-in defaults > generic fallback.
 * When stashOutput wrote a file, the file path is prepended.
 */
function buildRedirectionHint(
  toolName: string,
  params: Record<string, unknown>,
  originalLength: number,
  result: Record<string, unknown>,
  config?: OutputPolicyConfig,
  stashedPath?: string,
): string {
  // 1. Custom buildHint callback
  if (config?.buildHint) {
    const custom = config.buildHint(toolName, params, originalLength, result);
    if (custom !== undefined) {
      return stashedPath
        ? `Full output saved to ${stashedPath}. ${custom}`
        : custom;
    }
  }

  // 2. Custom hints map
  if (config?.hints?.[toolName]) {
    const hint = config.hints[toolName];
    return stashedPath ? `Full output saved to ${stashedPath}. ${hint}` : hint;
  }

  // 3. Built-in per-tool hints
  const builtIn = BUILT_IN_HINTS[toolName];
  if (builtIn) {
    const hint = builtIn(originalLength);
    return stashedPath ? `Full output saved to ${stashedPath}. ${hint}` : hint;
  }

  // 4. Generic fallback
  const hint = defaultHint(originalLength);
  return stashedPath ? `Full output saved to ${stashedPath}. ${hint}` : hint;
}

/**
 * Extract text content from a tool result for truncation checking.
 * Checks common shapes: { stdout }, { content }, or stringified JSON.
 */
function extractText(result: Record<string, unknown>): string | null {
  if (typeof result.stdout === "string") return result.stdout;
  if (typeof result.content === "string") return result.content;

  // For structured results, serialize and check length
  const serialized = JSON.stringify(result);
  return serialized;
}

/**
 * Inject truncated text and hint back into the result object.
 */
function injectTruncatedOutput(
  result: Record<string, unknown>,
  truncated: string,
  hint: string,
): Record<string, unknown> {
  // Replace the field that was extracted
  if (typeof result.stdout === "string") {
    return { ...result, stdout: truncated, _hint: hint };
  }
  if (typeof result.content === "string") {
    return { ...result, content: truncated, _hint: hint };
  }

  // For other structured results, preserve original fields and add truncation metadata
  return { ...result, _truncated: truncated, _hint: hint };
}

/**
 * Counter for unique stash file paths within a single process.
 * Prevents collisions when parallel tool calls generate paths
 * within the same millisecond.
 */
let stashCounter = 0;

/**
 * Generate a default stash file path.
 */
function defaultStashPath(dir: string, toolName: string): string {
  return `${dir}/${toolName}-${Date.now()}-${stashCounter++}.txt`;
}

/**
 * Create an output policy context layer that handles truncation
 * and injects redirection hints for tool results.
 *
 * Optionally writes full output to disk before truncating (stashOutput).
 */
export function createOutputPolicy(config?: OutputPolicyConfig): ContextLayer {
  const maxLen = config?.maxOutputLength ?? 30000;
  const redirectAt = config?.redirectionThreshold ?? 20000;
  const exclude = new Set(config?.excludeTools ?? []);
  const truncateFn = config?.truncate ?? middleTruncate;
  const stash = config?.stashOutput;
  const stashDir = stash?.dir ?? "/tmp/.bashkit/tool-output";
  const stashTools = stash ? new Set(stash.tools) : new Set<string>();
  let stashDirCreated = false;

  return {
    afterExecute: async (toolName, params, result) => {
      if (exclude.has(toolName)) return result;

      const text = extractText(result);
      if (!text || text.length <= redirectAt) return result;

      // Stash full output to disk if configured for this tool
      let stashedPath: string | undefined;
      if (stash && stashTools.has(toolName)) {
        // Determine file path
        stashedPath =
          stash.pathFor?.(toolName, params, result) ??
          defaultStashPath(stashDir, toolName);

        // Ensure directory exists (once)
        const dir = stashedPath.replace(/\/[^/]+$/, "");
        if (!stashDirCreated || dir !== stashDir) {
          await stash.sandbox.exec(`mkdir -p ${dir}`);
          if (dir === stashDir) stashDirCreated = true;
        }

        await stash.sandbox.writeFile(stashedPath, text);
      }

      // Truncate
      const truncated = truncateFn(text, maxLen);

      // Build redirection hint
      const hint = buildRedirectionHint(
        toolName,
        params,
        text.length,
        result,
        config,
        stashedPath,
      );

      return injectTruncatedOutput(result, truncated, hint);
    },
  };
}
