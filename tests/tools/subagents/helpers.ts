import type { SubagentRunner } from "@/subagents";
import {
  createStaticSubagentRunner,
  createSubagentController,
  createSubagentControlTools,
} from "@/index";

export function createCompletedTools() {
  const controller = createSubagentController({
    runner: createStaticSubagentRunner({
      status: "completed",
      result: "done",
    }),
  });
  return createSubagentControlTools(controller);
}

export function createLongRunningRunner(): SubagentRunner {
  return {
    capabilities: { interrupt: false, followup: false },
    async run(request) {
      await request.callbacks.onStatus("running");
      return new Promise(() => undefined);
    },
  };
}

export function createLongRunningTools() {
  const controller = createSubagentController({
    runner: createLongRunningRunner(),
  });
  return createSubagentControlTools(controller);
}
