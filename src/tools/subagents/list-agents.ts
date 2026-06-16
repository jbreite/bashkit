import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { SubagentController, SubagentStatus } from "../../subagents";
import type { ListAgentsOutput, SubagentToolError } from "./types";
import { compactSubagentRecord } from "./types";

const statusSchema = z.enum([
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "interrupted",
] satisfies SubagentStatus[]);

const listAgentsInputSchema = z.object({
  status: statusSchema
    .nullable()
    .default(null)
    .describe("Optional status filter."),
  path_prefix: z
    .string()
    .nullable()
    .default(null)
    .describe("Optional task_name prefix filter."),
  include_terminal: z
    .boolean()
    .nullable()
    .default(null)
    .describe("Whether to include completed, failed, and interrupted agents."),
  limit: z
    .number()
    .nullable()
    .default(null)
    .describe("Maximum number of agents to return."),
});

type ListAgentsInput = z.infer<typeof listAgentsInputSchema>;

const LIST_AGENTS_DESCRIPTION = `List known subagents and their compact status. Use this before waiting or messaging when you need to know which agents are active, completed, failed, or interrupted. This returns metadata and references, not full transcripts.`;

export function createListAgentsTool(controller: SubagentController) {
  return tool({
    description: LIST_AGENTS_DESCRIPTION,
    inputSchema: zodSchema(listAgentsInputSchema),
    execute: async (
      input: ListAgentsInput,
    ): Promise<ListAgentsOutput | SubagentToolError> => {
      const agents = await controller.list({
        status: input.status ?? undefined,
        pathPrefix: input.path_prefix ?? undefined,
        includeTerminal: input.include_terminal ?? undefined,
        limit: input.limit ?? undefined,
      });

      return {
        agents: agents.map(compactSubagentRecord),
      };
    },
  });
}
