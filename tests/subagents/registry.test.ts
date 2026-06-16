import { beforeEach, describe, expect, it } from "vitest";
import {
  createSubagentRegistry,
  resetSubagentIdCounterForTests,
} from "@/subagents";

describe("createSubagentRegistry", () => {
  beforeEach(() => resetSubagentIdCounterForTests());

  it("reserves generated ids and optional task names", () => {
    const registry = createSubagentRegistry();
    const metadata = registry.reserve({
      taskName: "research/auth",
      profile: "worker",
      nickname: "worker",
      depth: 0,
      lastTaskMessage: "Research auth",
    });

    expect(metadata).toMatchObject({
      agent_id: "agent_1",
      task_name: "research/auth",
      status: "pending",
    });
    expect(registry.get("research/auth")).toMatchObject({
      agent_id: "agent_1",
    });
  });

  it("rejects duplicate live task names", () => {
    const registry = createSubagentRegistry();
    registry.reserve({
      taskName: "research/auth",
      profile: "worker",
      nickname: null,
      depth: 0,
      lastTaskMessage: "first",
    });

    expect(
      registry.reserve({
        taskName: "research/auth",
        profile: "worker",
        nickname: null,
        depth: 0,
        lastTaskMessage: "second",
      }),
    ).toEqual({ error: "Subagent task_name already exists: research/auth" });
  });

  it("releases task names when a subagent reaches a terminal status", () => {
    const registry = createSubagentRegistry();
    const metadata = registry.reserve({
      taskName: "research/auth",
      profile: "worker",
      nickname: null,
      depth: 0,
      lastTaskMessage: "first",
    });
    if ("error" in metadata) throw new Error(metadata.error);

    registry.updateStatus(
      { agent_id: metadata.agent_id, task_name: metadata.task_name },
      "completed",
    );

    const next = registry.reserve({
      taskName: "research/auth",
      profile: "worker",
      nickname: null,
      depth: 0,
      lastTaskMessage: "second",
    });
    expect(next).toMatchObject({ task_name: "research/auth" });
  });
});
