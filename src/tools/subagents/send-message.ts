import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { SubagentController } from "../../subagents";
import type { MessageAgentOutput, SubagentToolError } from "./types";

const metadataSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

const sendMessageInputSchema = z.object({
  agent: z
    .string()
    .describe("Subagent id or task_name returned by SpawnAgent/ListAgents."),
  message: z.string().describe("Information to queue for the target subagent."),
  metadata: metadataSchema
    .nullable()
    .default(null)
    .describe("Optional host metadata for the message."),
});

type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

const SEND_MESSAGE_DESCRIPTION = `Queue information for an existing subagent without necessarily asking it to start a new turn. Use this for context, constraints, or updates the child should see. Use FollowupTask when you need the child to do more work.`;

export function createSendMessageTool(controller: SubagentController) {
  return tool({
    description: SEND_MESSAGE_DESCRIPTION,
    inputSchema: zodSchema(sendMessageInputSchema),
    execute: async (
      input: SendMessageInput,
    ): Promise<MessageAgentOutput | SubagentToolError> => {
      return await controller.sendMessage({
        agent: input.agent,
        message: input.message,
        metadata: input.metadata ?? undefined,
      });
    },
  });
}
