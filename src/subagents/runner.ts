import type {
  SubagentRunner,
  SubagentRunnerCapabilities,
  SubagentRunResult,
} from "./types";

export const DEFAULT_SUBAGENT_RUNNER_CAPABILITIES: SubagentRunnerCapabilities =
  {
    interrupt: false,
    followup: false,
  };

export function createStaticSubagentRunner(
  result: Pick<SubagentRunResult, "status" | "result" | "error" | "usage">,
): SubagentRunner {
  return {
    capabilities: DEFAULT_SUBAGENT_RUNNER_CAPABILITIES,
    async run(request) {
      await request.callbacks.onStatus("running");
      return {
        agent_id: request.handle.agent_id,
        task_name: request.handle.task_name,
        ...result,
      };
    },
  };
}

export {
  createAiSdkSubagentRunner,
  type AiSdkSubagentGenerateOptions,
  type AiSdkSubagentGenerateResult,
  type AiSdkSubagentGenerateText,
  type AiSdkSubagentRunnerConfig,
} from "./ai-sdk-runner";
