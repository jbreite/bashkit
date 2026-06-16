import { describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import {
  createInMemorySubagentStore,
  createStaticSubagentRunner,
  createSubagentControlPanelState,
  createSubagentController,
  type SubagentRunner,
} from "@/subagents";

function model(modelId: string): LanguageModel {
  return { modelId } as LanguageModel;
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createSubagentControlPanelState", () => {
  it("projects active agents with model identity and supported actions", async () => {
    const store = createInMemorySubagentStore();
    const runner: SubagentRunner = {
      capabilities: { interrupt: true, followup: true },
      async run(request) {
        await request.callbacks.onStatus("running");
        return new Promise(() => undefined);
      },
    };
    const controller = createSubagentController({
      store,
      runner,
      profiles: [
        {
          name: "researcher",
          model: model("cheap-research-model"),
        },
      ],
    });

    const spawned = await controller.spawn({
      task: "Research auth",
      profile: "researcher",
      task_name: "research/auth",
    });
    if ("error" in spawned) throw new Error(spawned.error);
    await tick();

    const state = createSubagentControlPanelState({
      records: await store.list(),
      capabilities: runner.capabilities,
    });

    expect(state.active_agents).toHaveLength(1);
    expect(state.active_agents[0]).toMatchObject({
      agent_id: spawned.agent_id,
      task_name: "research/auth",
      profile: "researcher",
      model: { id: "cheap-research-model" },
      supported_actions: ["wait", "message", "followup", "interrupt"],
    });
    expect(state.stats).toMatchObject({ total: 1, active: 1, terminal: 0 });
  });

  it("projects terminal agents without embedding result text", async () => {
    const store = createInMemorySubagentStore();
    const controller = createSubagentController({
      store,
      runner: createStaticSubagentRunner({
        status: "completed",
        result: "full child result should stay out of the panel",
      }),
      profiles: [{ name: "worker", model: model("worker-model") }],
    });

    const spawned = await controller.spawn({ task: "Build report" });
    if ("error" in spawned) throw new Error(spawned.error);
    await controller.wait({ agent: spawned.agent_id, timeoutMs: 500 });

    const state = createSubagentControlPanelState({
      records: await store.list(),
    });

    expect(state.active_agents).toHaveLength(0);
    expect(state.terminal_agents).toHaveLength(1);
    expect(state.terminal_agents[0]).toMatchObject({
      status: "completed",
      model: { id: "worker-model" },
      supported_actions: ["wait"],
    });
    expect("result" in state.terminal_agents[0]).toBe(false);
    expect(JSON.stringify(state)).not.toContain("full child result");
  });

  it("includes recent events and budget warnings in a serializable snapshot", async () => {
    const store = createInMemorySubagentStore();
    const controller = createSubagentController({
      store,
      runner: createStaticSubagentRunner({
        status: "failed",
        error: "child failed",
      }),
    });

    const spawned = await controller.spawn({ task: "Fail" });
    if ("error" in spawned) throw new Error(spawned.error);
    await controller.wait({ agent: spawned.agent_id, timeoutMs: 500 });

    const state = createSubagentControlPanelState({
      records: await store.list(),
      budget: {
        totalCostUsd: 2,
        maxUsd: 1,
        remainingUsd: 0,
        usagePercent: 200,
        stepsCompleted: 1,
        exceeded: true,
        unpricedSteps: 1,
      },
      recentEventLimit: 2,
    });

    expect(state.recent_events.length).toBeLessThanOrEqual(2);
    expect(state.warnings).toEqual(["Budget exceeded", "1 unpriced step(s)"]);
    expect(() => JSON.stringify(state)).not.toThrow();
  });
});
