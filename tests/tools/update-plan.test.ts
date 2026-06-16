import { describe, expect, it } from "vitest";
import {
  createMemoryRuntimeEventSink,
  createPlanState,
  type PlanState,
} from "@/runtime";
import {
  createUpdatePlanTool,
  type UpdatePlanOutput,
} from "@/tools/update-plan";
import { assertError, assertSuccess, executeTool } from "@test/helpers";

describe("UpdatePlan Tool", () => {
  it("updates PlanState and emits a runtime plan.updated event", async () => {
    const state = createPlanState();
    const sink = createMemoryRuntimeEventSink();
    const tool = createUpdatePlanTool(state, {
      eventSink: sink,
      context: { thread_id: "thread_1" },
    });

    const result = await executeTool(tool, {
      explanation: "Making progress",
      plan: [
        { step: "Design", status: "completed" },
        { step: "Implement", status: "in_progress" },
      ],
    });

    assertSuccess<UpdatePlanOutput>(result);
    expect(result).toEqual({
      message: "Plan updated",
      stats: {
        total: 2,
        pending: 0,
        in_progress: 1,
        completed: 1,
      },
    });
    expect(state.explanation).toBe("Making progress");
    expect(sink.events[0]).toMatchObject({
      type: "plan.updated",
      thread_id: "thread_1",
    });
  });

  it("returns an error when more than one item is in progress", async () => {
    const tool = createUpdatePlanTool(createPlanState());
    const result = await executeTool(tool, {
      explanation: null,
      plan: [
        { step: "One", status: "in_progress" },
        { step: "Two", status: "in_progress" },
      ],
    });

    assertError(result);
    expect(result.error).toBe("At most one plan item can be in_progress");
  });

  it("is blocked while plan mode is active", async () => {
    const state: PlanState = createPlanState();
    const tool = createUpdatePlanTool(state, {
      planModeState: { isActive: true },
    });

    const result = await executeTool(tool, {
      explanation: null,
      plan: [{ step: "Plan", status: "pending" }],
    });

    assertError(result);
    expect(result.error).toContain("not allowed in Plan mode");
    expect(state.plan).toEqual([]);
  });
});
