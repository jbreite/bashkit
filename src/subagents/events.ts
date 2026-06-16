import { createRuntimeEvent } from "../runtime";
import type { RuntimeEvent, RuntimeUsage } from "../runtime";
import type { SubagentEvent, SubagentEventSink } from "./types";

export interface MemorySubagentEventSink extends SubagentEventSink {
  readonly events: SubagentEvent[];
}

export function createMemorySubagentEventSink(): MemorySubagentEventSink {
  const events: SubagentEvent[] = [];
  return {
    events,
    emit(event: SubagentEvent): void {
      events.push(event);
    },
  };
}

export async function emitSubagentEvent(
  sink: SubagentEventSink | undefined,
  event: SubagentEvent,
): Promise<void> {
  await sink?.emit(event);
}

function numberFromPayload(
  payload: SubagentEvent["payload"],
  key: string,
): number | undefined {
  const value = payload?.[key];
  return typeof value === "number" ? value : undefined;
}

function stringFromPayload(
  payload: SubagentEvent["payload"],
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

function runtimeUsageFromPayload(
  payload: SubagentEvent["payload"],
): RuntimeUsage {
  return {
    input_tokens: numberFromPayload(payload, "inputTokens"),
    output_tokens: numberFromPayload(payload, "outputTokens"),
    total_cost_usd: numberFromPayload(payload, "totalCostUsd"),
  };
}

export function subagentEventToRuntimeEvent(
  event: SubagentEvent,
): RuntimeEvent | null {
  const common = {
    agent_id: event.agent_id,
    parent_agent_id: event.parent_id,
    metadata: {
      source: "subagent",
      subagent_event_type: event.type,
    },
    timestamp: event.timestamp,
  } as const;

  switch (event.type) {
    case "subagent.created":
      return createRuntimeEvent({
        ...common,
        type: "agent.created",
        status: event.status,
        task_name: event.task_name,
        profile: event.profile,
      });
    case "subagent.started":
      return createRuntimeEvent({
        ...common,
        type: "agent.started",
        status: event.status,
        task_name: event.task_name,
        profile: event.profile,
      });
    case "subagent.status_changed":
      return createRuntimeEvent({
        ...common,
        type: "agent.status_changed",
        status: event.status,
        task_name: event.task_name,
        profile: event.profile,
      });
    case "subagent.message_queued":
      return createRuntimeEvent({
        ...common,
        type: "agent.message_queued",
        status: event.status,
        task_name: event.task_name,
        profile: event.profile,
        message: stringFromPayload(event.payload, "message"),
      });
    case "subagent.completed":
      return createRuntimeEvent({
        ...common,
        type: "agent.completed",
        status: event.status,
        task_name: event.task_name,
        profile: event.profile,
      });
    case "subagent.failed":
      return createRuntimeEvent({
        ...common,
        type: "agent.failed",
        status: event.status,
        task_name: event.task_name,
        profile: event.profile,
        error: stringFromPayload(event.payload, "error"),
      });
    case "subagent.interrupted":
      return createRuntimeEvent({
        ...common,
        type: "agent.interrupted",
        status: event.status,
        task_name: event.task_name,
        profile: event.profile,
      });
    case "subagent.usage":
      return createRuntimeEvent({
        ...common,
        type: "cost.updated",
        usage: runtimeUsageFromPayload(event.payload),
      });
    case "subagent.tool_call":
    case "subagent.tool_result":
      return null;
  }
}
