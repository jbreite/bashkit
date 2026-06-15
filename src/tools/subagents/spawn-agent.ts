import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { SubagentController } from "../../subagents";
import type {
  SpawnAgentOutput,
  SubagentControlToolConfig,
  SubagentToolError,
} from "./types";

const metadataSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

const spawnAgentInputSchema = z.object({
  task: z.string().describe("The task the subagent should work on."),
  profile: z
    .string()
    .nullable()
    .default(null)
    .describe("Optional subagent profile name."),
  task_name: z
    .string()
    .nullable()
    .default(null)
    .describe("Optional path-like name such as research/auth."),
  context: z
    .union([
      z.literal("none"),
      z.literal("all"),
      z.object({ recent_turns: z.number() }),
    ])
    .nullable()
    .default(null)
    .describe("Optional context inheritance policy."),
  tools: z
    .array(z.string())
    .nullable()
    .default(null)
    .describe("Optional allowed tool names for this child."),
  metadata: metadataSchema
    .nullable()
    .default(null)
    .describe("Optional host metadata for the child."),
});

type SpawnAgentInput = z.infer<typeof spawnAgentInputSchema>;

const SPAWN_AGENT_DESCRIPTION = `Spawn a subagent for separable work. Use this when work can run independently, such as research, review, verification, or a focused implementation task. The call returns immediately with a handle; use ListAgents or WaitAgent to inspect progress. Avoid redundant fan-out and do not spawn agents for tiny tasks you can complete directly.`;

export function createSpawnAgentTool(
  controller: SubagentController,
  _config?: SubagentControlToolConfig,
) {
  return tool({
    description: SPAWN_AGENT_DESCRIPTION,
    inputSchema: zodSchema(spawnAgentInputSchema),
    execute: async (
      input: SpawnAgentInput,
    ): Promise<SpawnAgentOutput | SubagentToolError> => {
      const result = await controller.spawn({
        task: input.task,
        profile: input.profile ?? undefined,
        task_name: input.task_name ?? null,
        context: input.context ?? undefined,
        tools: input.tools ?? null,
        metadata: input.metadata ?? undefined,
      });
      return result;
    },
  });
}
