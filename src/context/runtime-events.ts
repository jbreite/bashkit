import {
  createRuntimeEvent,
  type JsonObject,
  type JsonValue,
  type RuntimeEventSink,
} from "../runtime";
import type { ContextLayer } from "./index";

export interface RuntimeEventLayerConfig {
  eventSink: RuntimeEventSink;
  agentId?: string | null;
  threadId?: string | null;
  turnId?: string | null;
}

interface ToolCallMeta {
  tool_call_id: string;
  started_at: number;
}

let toolCallCounter = 0;

function createToolCallId(toolName: string): string {
  toolCallCounter += 1;
  return `${toolName.toLowerCase()}_${toolCallCounter.toString(36).padStart(4, "0")}`;
}

function jsonValueFromUnknown(value: unknown): JsonValue {
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

function jsonObjectFromRecord(record: Record<string, unknown>): JsonObject {
  const objectValue: JsonObject = {};
  for (const [key, value] of Object.entries(record)) {
    objectValue[key] = jsonValueFromUnknown(value);
  }
  return objectValue;
}

export function createRuntimeEventLayer(
  config: RuntimeEventLayerConfig,
): ContextLayer {
  const calls = new WeakMap<Record<string, unknown>, ToolCallMeta>();

  return {
    beforeExecute: async (toolName, params) => {
      const meta = {
        tool_call_id: createToolCallId(toolName),
        started_at: performance.now(),
      };
      calls.set(params, meta);

      await config.eventSink.emit(
        createRuntimeEvent({
          type: "tool.started",
          tool_call_id: meta.tool_call_id,
          tool_name: toolName,
          input: jsonObjectFromRecord(params),
          agent_id: config.agentId ?? null,
          thread_id: config.threadId ?? null,
          turn_id: config.turnId ?? null,
        }),
      );

      return undefined;
    },

    afterExecute: async (toolName, params, result) => {
      const meta =
        calls.get(params) ??
        ({
          tool_call_id: createToolCallId(toolName),
          started_at: performance.now(),
        } satisfies ToolCallMeta);
      const durationMs = Math.round(performance.now() - meta.started_at);

      if (typeof result.error === "string") {
        await config.eventSink.emit(
          createRuntimeEvent({
            type: "tool.failed",
            tool_call_id: meta.tool_call_id,
            tool_name: toolName,
            error: result.error,
            duration_ms: durationMs,
            agent_id: config.agentId ?? null,
            thread_id: config.threadId ?? null,
            turn_id: config.turnId ?? null,
          }),
        );
      } else {
        await config.eventSink.emit(
          createRuntimeEvent({
            type: "tool.completed",
            tool_call_id: meta.tool_call_id,
            tool_name: toolName,
            output: jsonValueFromUnknown(result),
            duration_ms: durationMs,
            agent_id: config.agentId ?? null,
            thread_id: config.threadId ?? null,
            turn_id: config.turnId ?? null,
          }),
        );
      }

      calls.delete(params);
      return result;
    },
  };
}
