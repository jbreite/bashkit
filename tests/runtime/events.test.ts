import { describe, expect, it, vi } from "vitest";
import {
  createApprovalRequest,
  createApprovalRequestedEvent,
  createApprovalResolvedEvent,
  createApprovalResult,
  createMemoryRuntimeEventSink,
  createRuntimeEvent,
  projectChangesSnapshot,
  projectProgressSnapshot,
  resetApprovalIdCounterForTests,
} from "@/runtime";

describe("runtime events", () => {
  it("records events and notifies subscribers", async () => {
    const sink = createMemoryRuntimeEventSink();
    const listener = vi.fn();
    const unsubscribe = sink.subscribe(listener);

    const event = createRuntimeEvent({
      type: "thread.started",
      thread_id: "thread_1",
    });
    await sink.emit(event);
    unsubscribe();
    await sink.emit(
      createRuntimeEvent({ type: "turn.started", turn_id: "turn_1" }),
    );

    expect(sink.events.map((record) => record.type)).toEqual([
      "thread.started",
      "turn.started",
    ]);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);
  });

  it("creates approval lifecycle events", () => {
    resetApprovalIdCounterForTests();
    const approval = createApprovalRequest({
      agentId: "agent_1",
      subject: {
        type: "command",
        command: "bun run test",
        cwd: "/repo",
      },
      reason: "Command requires approval",
    });
    const result = createApprovalResult({
      approvalId: approval.approval_id,
      decision: "rejected",
      reason: "Too expensive right now",
    });

    expect(createApprovalRequestedEvent(approval)).toMatchObject({
      type: "approval.requested",
      agent_id: "agent_1",
    });
    expect(createApprovalResolvedEvent(approval, result)).toMatchObject({
      type: "approval.rejected",
      result: { decision: "rejected" },
    });
  });

  it("projects progress and latest file changes from events", () => {
    const events = [
      createRuntimeEvent({
        type: "agent.created",
        agent_id: "agent_1",
        parent_agent_id: null,
        status: "pending",
        task_name: "research",
        profile: "default",
      }),
      createRuntimeEvent({
        type: "file.changed",
        path: "src/a.ts",
        change: "created",
      }),
      createRuntimeEvent({
        type: "file.changed",
        path: "src/a.ts",
        change: "modified",
        unified_diff: "@@ diff",
      }),
      createRuntimeEvent({
        type: "plan.updated",
        explanation: null,
        plan: [{ step: "Ship", status: "in_progress" }],
        stats: {
          total: 1,
          pending: 0,
          in_progress: 1,
          completed: 0,
        },
      }),
    ];

    expect(projectChangesSnapshot(events)).toEqual([
      {
        path: "src/a.ts",
        change: "modified",
        unified_diff: "@@ diff",
        updated_at: events[2].timestamp,
      },
    ]);
    expect(projectProgressSnapshot(events).agents[0]).toMatchObject({
      agent_id: "agent_1",
      status: "pending",
    });
    expect(projectProgressSnapshot(events).plan?.plan[0].step).toBe("Ship");
  });
});
