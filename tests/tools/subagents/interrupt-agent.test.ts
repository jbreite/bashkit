import { describe, expect, it } from "vitest";
import { executeTool } from "@test/helpers";
import type { SubagentRunner } from "@/subagents";
import { createSubagentController, createSubagentControlTools } from "@/index";

describe("InterruptAgent tool", () => {
  it("returns an unsupported error when the runner cannot interrupt", async () => {
    const controller = createSubagentController({
      runner: {
        capabilities: { interrupt: false, followup: false },
        async run(request) {
          await request.callbacks.onStatus("running");
          return new Promise(() => undefined);
        },
      },
    });
    const tools = createSubagentControlTools(controller);
    const spawned = await executeTool(tools.SpawnAgent, {
      task: "Research",
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

    const result = await executeTool(tools.InterruptAgent, {
      agent: String(spawned.agent_id),
      reason: null,
    });

    expect(result).toEqual({
      error: "Subagent runner does not support interrupt",
    });
  });

  it("interrupts when the runner supports cancellation", async () => {
    const runner: SubagentRunner = {
      capabilities: { interrupt: true, followup: false },
      async run(request) {
        await request.callbacks.onStatus("running");
        return new Promise(() => undefined);
      },
      async interrupt(handle) {
        return {
          agent_id: handle.agent_id,
          previous_status: "running",
          status: "interrupted",
        };
      },
    };
    const controller = createSubagentController({ runner });
    const tools = createSubagentControlTools(controller);
    const spawned = await executeTool(tools.SpawnAgent, {
      task: "Research",
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

    const result = await executeTool(tools.InterruptAgent, {
      agent: String(spawned.agent_id),
      reason: "No longer needed",
    });

    expect(result).toMatchObject({
      agent_id: spawned.agent_id,
      previous_status: expect.stringMatching(/pending|running/),
      status: "interrupted",
    });
  });
});
