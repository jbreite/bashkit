import { describe, expect, it, vi } from "vitest";
import {
  createMemorySubagentEventSink,
  createStaticSubagentRunner,
  createSubagentController,
} from "@/subagents";
import type { SubagentRunner } from "@/subagents";

describe("createSubagentController", () => {
  it("spawns, runs, emits events, and waits for completion", async () => {
    const sink = createMemorySubagentEventSink();
    const onComplete = vi.fn();
    const controller = createSubagentController({
      runner: createStaticSubagentRunner({
        status: "completed",
        result: "done",
      }),
      eventSink: sink,
      lifecycle: { onComplete },
    });

    const spawned = await controller.spawn({
      task: "Research auth",
      task_name: "research/auth",
    });
    if ("error" in spawned) throw new Error(spawned.error);

    const waited = await controller.wait({
      agent: spawned.agent_id,
      timeoutMs: 500,
    });
    expect(waited).toMatchObject({
      status: "ready",
      result: { result: "done", status: "completed" },
    });
    expect(onComplete).toHaveBeenCalledOnce();
    expect(sink.events.map((event) => event.type)).toContain(
      "subagent.completed",
    );
  });

  it("records runner failures as failed terminal results", async () => {
    const runner: SubagentRunner = {
      capabilities: { interrupt: false, followup: false },
      async run() {
        throw new Error("runner failed");
      },
    };
    const controller = createSubagentController({ runner });
    const spawned = await controller.spawn({ task: "fail" });
    if ("error" in spawned) throw new Error(spawned.error);

    const waited = await controller.wait({
      agent: spawned.agent_id,
      timeoutMs: 500,
    });
    expect(waited).toMatchObject({
      status: "ready",
      result: { status: "failed", error: "runner failed" },
    });
  });

  it("queues messages and updates last task message", async () => {
    const controller = createSubagentController({
      runner: createStaticSubagentRunner({
        status: "completed",
        result: "done",
      }),
    });
    const spawned = await controller.spawn({ task: "Research" });
    if ("error" in spawned) throw new Error(spawned.error);

    const result = await controller.sendMessage({
      agent: spawned.agent_id,
      message: "new context",
    });
    expect(result).toMatchObject({
      queued: true,
      agent_id: spawned.agent_id,
      triggered_turn: false,
    });

    const agents = await controller.list();
    expect(agents[0].last_task_message).toBe("new context");
  });

  it("rejects spawns when active-agent limits are exhausted", async () => {
    const runner: SubagentRunner = {
      capabilities: { interrupt: false, followup: false },
      async run(request) {
        await request.callbacks.onStatus("running");
        return new Promise(() => undefined);
      },
    };
    const controller = createSubagentController({
      runner,
      profileDefaults: { cost: { maxActiveAgents: 1 } },
    });

    const first = await controller.spawn({ task: "one" });
    expect(first).not.toHaveProperty("error");
    const second = await controller.spawn({ task: "two" });
    expect(second).toEqual({ error: "Subagent active limit reached (1)" });
  });
});
