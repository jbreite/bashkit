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
