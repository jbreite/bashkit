import type { ModelMessage } from "ai";
import type { JsonObject, JsonValue, SubagentHandle } from "./types";

export interface SubagentTranscriptSummary {
  transcript_ref: string;
  result_ref: string;
  message_count: number;
}

export function createSubagentTranscriptRef(handle: SubagentHandle): string {
  return `subagent-transcript:${handle.agent_id}`;
}

export function createSubagentResultRef(handle: SubagentHandle): string {
  return `subagent-result:${handle.agent_id}`;
}

export function summarizeSubagentTranscript(
  handle: SubagentHandle,
  messages: readonly ModelMessage[] | undefined,
): SubagentTranscriptSummary {
  return {
    transcript_ref: createSubagentTranscriptRef(handle),
    result_ref: createSubagentResultRef(handle),
    message_count: messages?.length ?? 0,
  };
}

export function compactSubagentResult(text: string, maxLength = 4000): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n\n[Subagent result truncated: ${text.length - maxLength} characters omitted]`;
}

export function jsonValueFromUnknown(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => jsonValueFromUnknown(item));
  }

  if (typeof value === "object") {
    const objectValue: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      objectValue[key] = jsonValueFromUnknown(item);
    }
    return objectValue;
  }

  return String(value);
}

export function jsonObjectFromUnknown(value: unknown): JsonObject {
  const json = jsonValueFromUnknown(value);
  return typeof json === "object" && json !== null && !Array.isArray(json)
    ? json
    : { value: json };
}
