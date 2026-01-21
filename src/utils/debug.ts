/**
 * Debug logging utilities for bashkit tools.
 *
 * Enable debug logging via environment variable:
 * - BASHKIT_DEBUG=1 or BASHKIT_DEBUG=stderr - Human readable output to stderr
 * - BASHKIT_DEBUG=json - JSON lines to stderr
 * - BASHKIT_DEBUG=memory - In-memory array (retrieve via getDebugLogs())
 * - BASHKIT_DEBUG=file:/path/to/trace.jsonl - Write to file
 */

import { appendFileSync } from "node:fs";

/** Debug event structure for tool execution tracing */
export interface DebugEvent {
  /** Unique ID to correlate start/end events (e.g., "grep-1") */
  id: string;
  /** Timestamp in milliseconds */
  ts: number;
  /** Tool name */
  tool: string;
  /** Event type */
  event: "start" | "end" | "error";
  /** Input parameters (start events only, summarized) */
  input?: unknown;
  /** Output data (end events only, summarized) */
  output?: unknown;
  /** Key metrics like exitCode, matchCount, etc. */
  summary?: Record<string, unknown>;
  /** Duration in milliseconds (end events only) */
  duration_ms?: number;
  /** Parent event ID for nested tool calls (e.g., task → subagent tools) */
  parent?: string;
  /** Error message (error events only) */
  error?: string;
}

type DebugMode = "off" | "stderr" | "json" | "memory" | "file";

interface DebugState {
  mode: DebugMode;
  filePath?: string;
  logs: DebugEvent[];
  counters: Map<string, number>;
  parentStack: string[];
}

// Global debug state
const state: DebugState = {
  mode: "off",
  logs: [],
  counters: new Map(),
  parentStack: [],
};

// Truncation limits
const MAX_STRING_LENGTH = 1000;
const MAX_ARRAY_ITEMS = 10;

/**
 * Initialize debug mode from environment variable.
 * Called lazily on first debug operation.
 */
function initDebugMode(): void {
  const envValue = process.env.BASHKIT_DEBUG;

  if (!envValue) {
    state.mode = "off";
    return;
  }

  if (envValue === "1" || envValue === "stderr") {
    state.mode = "stderr";
  } else if (envValue === "json") {
    state.mode = "json";
  } else if (envValue === "memory") {
    state.mode = "memory";
  } else if (envValue.startsWith("file:")) {
    state.mode = "file";
    state.filePath = envValue.slice(5);
  } else {
    // Default to human-readable if unrecognized value
    state.mode = "stderr";
  }
}

// Initialize on module load
initDebugMode();

/**
 * Checks if debug mode is enabled (any mode except "off").
 */
export function isDebugEnabled(): boolean {
  return state.mode !== "off";
}

/**
 * Generate a unique event ID for a tool call.
 */
function generateId(tool: string): string {
  const count = (state.counters.get(tool) || 0) + 1;
  state.counters.set(tool, count);
  return `${tool}-${count}`;
}

/**
 * Truncate a string to MAX_STRING_LENGTH with indicator.
 */
function truncateString(str: string): string {
  if (str.length <= MAX_STRING_LENGTH) return str;
  return `${str.slice(0, MAX_STRING_LENGTH)}... [truncated, ${str.length - MAX_STRING_LENGTH} more chars]`;
}

/**
 * Summarize data for debug output.
 * - Truncates strings to 1000 chars
 * - Limits arrays to 10 items
 * - Recursively summarizes nested objects
 */
export function summarize(data: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 5) return "[nested object]";

  if (data === null || data === undefined) return data;

  if (typeof data === "string") {
    return truncateString(data);
  }

  if (typeof data === "number" || typeof data === "boolean") {
    return data;
  }

  if (Array.isArray(data)) {
    const truncated = data.length > MAX_ARRAY_ITEMS;
    const items = data
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => summarize(item, depth + 1));
    if (truncated) {
      return [...items, `[${data.length - MAX_ARRAY_ITEMS} more items]`];
    }
    return items;
  }

  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = summarize(value, depth + 1);
    }
    return result;
  }

  return String(data);
}

/**
 * Output a debug event according to current mode.
 */
function emitEvent(event: DebugEvent): void {
  if (state.mode === "off") return;

  switch (state.mode) {
    case "memory":
      state.logs.push(event);
      break;

    case "json":
      process.stderr.write(`${JSON.stringify(event)}\n`);
      break;

    case "file":
      if (state.filePath) {
        appendFileSync(state.filePath, `${JSON.stringify(event)}\n`);
      }
      break;

    case "stderr":
    default:
      formatHumanReadable(event);
      break;
  }
}

/**
 * Format and output human-readable debug message.
 */
function formatHumanReadable(event: DebugEvent): void {
  const indent = "  ".repeat(state.parentStack.length);

  if (event.event === "start") {
    const inputSummary = event.input
      ? Object.entries(event.input as Record<string, unknown>)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .slice(0, 3)
          .join(" ")
      : "";
    process.stderr.write(
      `${indent}[bashkit:${event.tool}] → ${inputSummary}\n`,
    );
  } else if (event.event === "end") {
    const summaryStr = event.summary
      ? Object.entries(event.summary)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(" ")
      : "";
    process.stderr.write(
      `${indent}[bashkit:${event.tool}] ← ${event.duration_ms}ms ${summaryStr}\n`,
    );
  } else if (event.event === "error") {
    process.stderr.write(`${indent}[bashkit:${event.tool}] ✗ ${event.error}\n`);
  }
}

/**
 * Record the start of a tool execution.
 * @returns Event ID to correlate with debugEnd/debugError
 */
export function debugStart(
  tool: string,
  input?: Record<string, unknown>,
): string {
  if (state.mode === "off") return "";

  const id = generateId(tool);
  const parent =
    state.parentStack.length > 0
      ? state.parentStack[state.parentStack.length - 1]
      : undefined;

  const event: DebugEvent = {
    id,
    ts: Date.now(),
    tool,
    event: "start",
    input: input ? summarize(input) : undefined,
    parent,
  };

  emitEvent(event);
  return id;
}

/**
 * Record the successful end of a tool execution.
 */
export function debugEnd(
  id: string,
  tool: string,
  options: {
    output?: unknown;
    summary?: Record<string, unknown>;
    duration_ms: number;
  },
): void {
  if (state.mode === "off" || !id) return;

  const event: DebugEvent = {
    id,
    ts: Date.now(),
    tool,
    event: "end",
    output: options.output ? summarize(options.output) : undefined,
    summary: options.summary,
    duration_ms: options.duration_ms,
  };

  emitEvent(event);
}

/**
 * Record an error during tool execution.
 */
export function debugError(
  id: string,
  tool: string,
  error: string | Error,
): void {
  if (state.mode === "off" || !id) return;

  const event: DebugEvent = {
    id,
    ts: Date.now(),
    tool,
    event: "error",
    error: error instanceof Error ? error.message : error,
  };

  emitEvent(event);
}

/**
 * Push a parent context for nested tool calls (e.g., when Task starts a subagent).
 */
export function pushParent(id: string): void {
  if (state.mode === "off" || !id) return;
  state.parentStack.push(id);
}

/**
 * Pop the current parent context.
 */
export function popParent(): void {
  if (state.mode === "off") return;
  state.parentStack.pop();
}

/**
 * Get all debug logs (memory mode only).
 * @returns Array of debug events, or empty array if not in memory mode
 */
export function getDebugLogs(): DebugEvent[] {
  return [...state.logs];
}

/**
 * Clear all debug logs (memory mode).
 * Call this between agent runs to reset the trace.
 */
export function clearDebugLogs(): void {
  state.logs = [];
  state.counters.clear();
  state.parentStack = [];
}

/**
 * Force re-initialization of debug mode from environment.
 * Useful for testing or when environment changes.
 */
export function reinitDebugMode(): void {
  state.logs = [];
  state.counters.clear();
  state.parentStack = [];
  initDebugMode();
}
