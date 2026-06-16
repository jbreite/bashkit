import { describe, expect, it } from "vitest";
import { executeTool } from "@test/helpers";
import type { SubagentRunner } from "@/subagents";
import { createSubagentController, createSubagentControlTools } from "@/index";
import { createLongRunningRunner, createLongRunningTools } from "./helpers";

describe("SendMessage and FollowupTask tools", () => {
  it("queues messages for existing agents", async () => {
    const tools = createLongRunningTools();
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

    const result = await executeTool(tools.SendMessage, {
      agent: String(spawned.agent_id),
      message: "Use the new constraint",
      metadata: null,
    });

    expect(result).toMatchObject({
      queued: true,
      agent_id: spawned.agent_id,
      triggered_turn: false,
    });
  });

  it("rejects follow-up tasks targeting the current agent", async () => {
    const controller = createSubagentController({
      runner: createLongRunningRunner(),
    });
    const tools = createSubagentControlTools(controller, {
      currentAgentId: "agent_1",
    });

    const result = await executeTool(tools.FollowupTask, {
      agent: "agent_1",
      task: "Continue",
      metadata: null,
    });

    expect(result).toEqual({
      error: "FollowupTask cannot target the current agent",
    });
  });

  it("requests a turn when the runner supports follow-ups", async () => {
    const runner: SubagentRunner = {
      capabilities: { interrupt: false, followup: true },
      async run(request) {
        await request.callbacks.onStatus("waiting");
        return new Promise(() => undefined);
      },
      async requestTurn(handle) {
        return {
          queued: true,
          agent_id: handle.agent_id,
          message_id: "runner-turn",
          triggered_turn: true,
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

    const result = await executeTool(tools.FollowupTask, {
      agent: String(spawned.agent_id),
      task: "Continue",
      metadata: null,
    });

    expect(result).toMatchObject({
      queued: true,
      triggered_turn: true,
    });
  });
});
