import { describe, expect, it } from "vitest";
import { executeTool } from "@test/helpers";
import { createCompletedTools, createLongRunningTools } from "./helpers";

describe("WaitAgent tool", () => {
  it("returns terminal results when a subagent completes", async () => {
    const tools = createCompletedTools();
    const spawned = await executeTool(tools.SpawnAgent, {
      task: "Research auth",
      task_name: "research/auth",
      profile: null,
      context: null,
      tools: null,
      metadata: null,
    });
    if (
      typeof spawned !== "object" ||
      spawned === null ||
      !("agent_id" in spawned)
    ) {
      throw new Error("spawn failed");
    }

    const result = await executeTool(tools.WaitAgent, {
      agent: String(spawned.agent_id),
      timeout_ms: 500,
      until_status: null,
    });

    expect(result).toMatchObject({
      status: "ready",
      agent: { status: "completed" },
      result: { status: "completed", result: "done" },
    });
  });

  it("returns timeout without changing status", async () => {
    const tools = createLongRunningTools();
    const spawned = await executeTool(tools.SpawnAgent, {
      task: "Research auth",
      task_name: null,
      profile: null,
      context: null,
      tools: null,
      metadata: null,
    });
    if (
      typeof spawned !== "object" ||
      spawned === null ||
      !("agent_id" in spawned)
    ) {
      throw new Error("spawn failed");
    }

    const result = await executeTool(tools.WaitAgent, {
      agent: String(spawned.agent_id),
      timeout_ms: 100,
      until_status: "completed",
    });

    expect(result).toMatchObject({
      status: "timeout",
      agent: { agent_id: spawned.agent_id },
    });
  });
});
