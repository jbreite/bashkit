import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { SubagentController } from "../../subagents";
import type { InterruptAgentOutput, SubagentToolError } from "./types";

const interruptAgentInputSchema = z.object({
  agent: z
    .string()
    .describe("Subagent id or task_name returned by SpawnAgent/ListAgents."),
  reason: z
    .string()
    .nullable()
    .default(null)
    .describe("Optional reason for interrupting the subagent."),
});

type InterruptAgentInput = z.infer<typeof interruptAgentInputSchema>;

const INTERRUPT_AGENT_DESCRIPTION = `Request cancellation of an existing subagent. This is best effort and depends on the configured runner. Use when the child is no longer needed, is stuck, or is working on obsolete instructions.`;

export function createInterruptAgentTool(controller: SubagentController) {
  return tool({
    description: INTERRUPT_AGENT_DESCRIPTION,
    inputSchema: zodSchema(interruptAgentInputSchema),
    execute: async (
      input: InterruptAgentInput,
    ): Promise<InterruptAgentOutput | SubagentToolError> => {
      return await controller.interrupt({
        agent: input.agent,
        reason: input.reason ?? null,
      });
    },
  });
}
