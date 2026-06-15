import type {
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeEventSink,
} from "./types";

type RuntimeEventInput = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Omit<Event, "timestamp"> & { timestamp?: string }
    : never
  : never;

export interface MemoryRuntimeEventSink extends RuntimeEventSink {
  readonly events: RuntimeEvent[];
  subscribe(listener: RuntimeEventListener): () => void;
}

export function createRuntimeEvent(event: RuntimeEventInput): RuntimeEvent {
  return {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  } as RuntimeEvent;
}

export function createMemoryRuntimeEventSink(): MemoryRuntimeEventSink {
  const events: RuntimeEvent[] = [];
  const listeners = new Set<RuntimeEventListener>();

  return {
    events,
    async emit(event: RuntimeEvent): Promise<void> {
      events.push(event);
      for (const listener of listeners) {
        await listener(event);
      }
    },
    subscribe(listener: RuntimeEventListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export async function emitRuntimeEvent(
  sink: RuntimeEventSink | undefined,
  event: RuntimeEvent,
): Promise<void> {
  await sink?.emit(event);
}
