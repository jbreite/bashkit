import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { SubagentController } from "../../subagents";
import type {
  MessageAgentOutput,
  SubagentControlToolConfig,
  SubagentToolError,
} from "./types";

const metadataSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

const followupTaskInputSchema = z.object({
  agent: z
    .string()
    .describe("Subagent id or task_name returned by SpawnAgent/ListAgents."),
  task: z.string().describe("Additional work for the target subagent."),
  metadata: metadataSchema
    .nullable()
    .default(null)
    .describe("Optional host metadata for the follow-up task."),
});

type FollowupTaskInput = z.infer<typeof followupTaskInputSchema>;

const FOLLOWUP_TASK_DESCRIPTION = `Queue additional work for an existing subagent and request another turn when the runner supports it. Do not target yourself; use this for continuing child work after inspecting progress or results.`;

export function createFollowupTaskTool(
  controller: SubagentController,
  config?: SubagentControlToolConfig,
) {
  return tool({
    description: FOLLOWUP_TASK_DESCRIPTION,
    inputSchema: zodSchema(followupTaskInputSchema),
    execute: async (
      input: FollowupTaskInput,
    ): Promise<MessageAgentOutput | SubagentToolError> => {
      if (config?.currentAgentId && input.agent === config.currentAgentId) {
        return { error: "FollowupTask cannot target the current agent" };
      }

      return await controller.followupTask({
        agent: input.agent,
        message: input.task,
        task: input.task,
        metadata: input.metadata ?? undefined,
      });
    },
  });
}
