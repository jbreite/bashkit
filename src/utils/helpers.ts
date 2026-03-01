import type { ToolCallPart, ToolResultPart } from "ai";

/**
 * Type guard for tool call content parts in AI SDK messages.
 * Checks the `type` discriminant to avoid false positives from objects
 * that happen to have `toolName` and `input` properties.
 */
export function isToolCallPart(part: unknown): part is ToolCallPart {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as Record<string, unknown>).type === "tool-call" &&
    "toolName" in part &&
    "input" in part
  );
}

/**
 * Type guard for tool result content parts in AI SDK messages.
 * Checks the `type` discriminant to avoid false positives from objects
 * that happen to have `toolName` and `output` properties.
 */
export function isToolResultPart(part: unknown): part is ToolResultPart {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as Record<string, unknown>).type === "tool-result" &&
    "toolName" in part &&
    "output" in part
  );
}

/**
 * Middle-truncates text, keeping the first half and last half with a
 * marker in between. Preserves both the beginning context and the
 * actionable end (error summaries, test failures).
 *
 * Inspired by OpenAI Codex's truncate.rs — 50/50 head/tail split.
 */
export function middleTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const headLength = Math.floor(maxLength / 2);
  const tailLength = maxLength - headLength;
  const omitted = text.length - headLength - tailLength;
  const totalLines = text.split("\n").length;

  return (
    `[Total output lines: ${totalLines}]\n\n` +
    text.slice(0, headLength) +
    `\n\n…${omitted} chars truncated…\n\n` +
    text.slice(text.length - tailLength)
  );
}
