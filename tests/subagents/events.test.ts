import { describe, expect, it } from "vitest";
import { createMemoryRuntimeEventSink } from "@/runtime";
import {
  createStaticSubagentRunner,
  createSubagentController,
  subagentEventToRuntimeEvent,
  type SubagentEvent,
} from "@/subagents";

describe("subagent runtime event bridge", () => {
  it("maps subagent lifecycle events to runtime agent events", () => {
    const event: SubagentEvent = {
      type: "subagent.created",
      agent_id: "agent_1",
      task_name: "research",
      parent_id: null,
      profile: "default",
      status: "pending",
      timestamp: "2026-06-15T00:00:00.000Z",
    };

    expect(subagentEventToRuntimeEvent(event)).toMatchObject({
      type: "agent.created",
      agent_id: "agent_1",
      task_name: "research",
      status: "pending",
    });
  });

  it("emits normalized runtime events from the controller", async () => {
    const runtimeSink = createMemoryRuntimeEventSink();
    const controller = createSubagentController({
      runner: createStaticSubagentRunner({
        status: "completed",
        result: "done",
      }),
      runtimeEventSink: runtimeSink,
    });

    const spawned = await controller.spawn({
      task: "Research auth",
      task_name: "research/auth",
    });
    if ("error" in spawned) throw new Error(spawned.error);

    await controller.wait({ agent: spawned.agent_id, timeoutMs: 500 });

    expect(runtimeSink.events.map((event) => event.type)).toContain(
      "agent.created",
    );
    expect(runtimeSink.events.map((event) => event.type)).toContain(
      "agent.completed",
    );
  });
});
