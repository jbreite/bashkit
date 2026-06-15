import { describe, expect, it } from "vitest";
import {
  createMemoryRuntimeEventSink,
  createPlanState,
  getPlanStats,
  projectPlanSnapshot,
  updatePlanState,
} from "@/runtime";

describe("runtime plan state", () => {
  it("updates canonical Codex-style plan state and emits plan.updated", async () => {
    const state = createPlanState();
    const sink = createMemoryRuntimeEventSink();

    const result = await updatePlanState(
      state,
      {
        explanation: "Starting implementation",
        plan: [
          { step: "Read plan", status: "completed" },
          { step: "Write code", status: "in_progress" },
        ],
      },
      {
        eventSink: sink,
        context: { agent_id: "agent_1", turn_id: "turn_1" },
      },
    );

    if ("error" in result) throw new Error(result.error);
    expect(result.snapshot.stats).toEqual({
      total: 2,
      pending: 0,
      in_progress: 1,
      completed: 1,
    });
    expect(state.plan[1].step).toBe("Write code");
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      type: "plan.updated",
      agent_id: "agent_1",
      turn_id: "turn_1",
    });
    expect(projectPlanSnapshot(sink.events)?.plan).toEqual(
      result.snapshot.plan,
    );
  });

  it("rejects multiple in-progress items", async () => {
    const result = await updatePlanState(createPlanState(), {
      plan: [
        { step: "One", status: "in_progress" },
        { step: "Two", status: "in_progress" },
      ],
    });

    expect(result).toEqual({
      error: "At most one plan item can be in_progress",
    });
  });

  it("computes plan stats", () => {
    expect(
      getPlanStats([
        { step: "One", status: "pending" },
        { step: "Two", status: "completed" },
        { step: "Three", status: "completed" },
      ]),
    ).toEqual({
      total: 3,
      pending: 1,
      in_progress: 0,
      completed: 2,
    });
  });
});
