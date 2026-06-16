import { describe, expect, it } from "vitest";
import { executeTool } from "@test/helpers";
import { createLongRunningTools } from "./helpers";

describe("ListAgents tool", () => {
  it("lists compact agent records", async () => {
    const tools = createLongRunningTools();
    await executeTool(tools.SpawnAgent, {
      task: "Research auth",
      task_name: "research/auth",
      profile: null,
      context: null,
      tools: null,
      metadata: null,
    });

    const result = await executeTool(tools.ListAgents, {
      status: null,
      path_prefix: "research",
      include_terminal: false,
      limit: null,
    });

    expect(result).toMatchObject({
      agents: [
        {
          agent_id: "agent_1",
          task_name: "research/auth",
          profile: "worker",
          status: expect.stringMatching(/pending|running/),
          last_task_message: "Research auth",
        },
      ],
    });
  });

  it("filters by status", async () => {
    const tools = createLongRunningTools();
    await executeTool(tools.SpawnAgent, {
      task: "Research auth",
      task_name: null,
      profile: null,
      context: null,
      tools: null,
      metadata: null,
    });

    const result = await executeTool(tools.ListAgents, {
      status: "completed",
      path_prefix: null,
      include_terminal: true,
      limit: null,
    });

    expect(result).toEqual({ agents: [] });
  });
});
