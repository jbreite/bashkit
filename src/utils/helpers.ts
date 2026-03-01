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
