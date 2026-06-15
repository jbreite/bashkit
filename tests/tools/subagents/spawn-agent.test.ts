import { describe, expect, it } from "vitest";
import { executeTool } from "@test/helpers";
import { createLongRunningTools } from "./helpers";

describe("SpawnAgent tool", () => {
  it("spawns a subagent and returns a stable handle", async () => {
    const tools = createLongRunningTools();

    const result = await executeTool(tools.SpawnAgent, {
      task: "Research auth patterns",
      task_name: "research/auth",
      profile: null,
      context: null,
      tools: null,
      metadata: null,
    });

    expect(result).toMatchObject({
      agent_id: "agent_1",
      task_name: "research/auth",
      status: "pending",
      profile: "worker",
      nickname: "worker",
    });
  });

  it("returns controller errors for empty tasks", async () => {
    const tools = createLongRunningTools();

    const result = await executeTool(tools.SpawnAgent, {
      task: "",
      task_name: null,
      profile: null,
      context: null,
      tools: null,
      metadata: null,
    });

    expect(result).toEqual({ error: "Subagent task cannot be empty" });
  });

  it("returns controller errors for duplicate live task names", async () => {
    const tools = createLongRunningTools();
    await executeTool(tools.SpawnAgent, {
      task: "first",
      task_name: "research/auth",
      profile: null,
      context: null,
      tools: null,
      metadata: null,
    });

    const duplicate = await executeTool(tools.SpawnAgent, {
      task: "second",
      task_name: "research/auth",
      profile: null,
      context: null,
      tools: null,
      metadata: null,
    });

    expect(duplicate).toEqual({
      error: "Subagent task_name already exists: research/auth",
    });
  });
});
