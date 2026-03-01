import type { ToolCallPart, ToolResultPart } from "ai";

/**
 * Type guard for tool call content parts in AI SDK messages.
 */
export function isToolCallPart(part: unknown): part is ToolCallPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "toolName" in part &&
    "input" in part
  );
}

/**
 * Type guard for tool result content parts in AI SDK messages.
 */
export function isToolResultPart(part: unknown): part is ToolResultPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "toolName" in part &&
    "output" in part
  );
}
