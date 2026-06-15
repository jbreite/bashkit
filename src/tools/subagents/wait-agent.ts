import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { SubagentController, SubagentStatus } from "../../subagents";
import type { SubagentToolError, WaitAgentOutput } from "./types";
import { compactSubagentRecord } from "./types";

const statusSchema = z.enum([
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "interrupted",
] satisfies SubagentStatus[]);

const waitAgentInputSchema = z.object({
  agent: z
    .string()
    .describe("Subagent id or task_name returned by SpawnAgent/ListAgents."),
  timeout_ms: z
    .number()
    .nullable()
    .default(null)
    .describe("Optional bounded wait timeout in milliseconds."),
  until_status: statusSchema
    .nullable()
    .default(null)
    .describe("Optional non-terminal or terminal status to wait for."),
});

type WaitAgentInput = z.infer<typeof waitAgentInputSchema>;

const WAIT_AGENT_DESCRIPTION = `Wait briefly for a subagent to reach a status or terminal result. Use bounded waits and prefer ListAgents for polling. Waiting returns compact metadata and a terminal result when available.`;

export function createWaitAgentTool(controller: SubagentController) {
  return tool({
    description: WAIT_AGENT_DESCRIPTION,
    inputSchema: zodSchema(waitAgentInputSchema),
    execute: async (
      input: WaitAgentInput,
    ): Promise<WaitAgentOutput | SubagentToolError> => {
      const result = await controller.wait({
        agent: input.agent,
        timeoutMs: input.timeout_ms ?? null,
        untilStatus: input.until_status ?? null,
      });
      if ("error" in result) return result;

      return {
        status: result.status,
        agent: compactSubagentRecord(result.agent),
        result: result.status === "ready" ? result.result : undefined,
      };
    },
  });
}
