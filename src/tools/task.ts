import { tool, zodSchema, generateText, type Tool } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";

export interface TaskOutput {
  result: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  total_cost_usd?: number;
  duration_ms?: number;
}

export interface TaskError {
  error: string;
}

const taskInputSchema = z.object({
  description: z
    .string()
    .describe("A short (3-5 word) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z
    .string()
    .describe("The type of specialized agent to use for this task"),
});

type TaskInput = z.infer<typeof taskInputSchema>;

export interface SubagentTypeConfig {
  model?: LanguageModel;
  systemPrompt?: string;
  tools?: string[];
}

export interface TaskToolConfig {
  model: LanguageModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Record<string, Tool<any, any>>;
  subagentTypes?: Record<string, SubagentTypeConfig>;
  costPerInputToken?: number;
  costPerOutputToken?: number;
}

function filterTools(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allTools: Record<string, Tool<any, any>>,
  allowedTools?: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, Tool<any, any>> {
  if (!allowedTools) return allTools;

  const filtered: typeof allTools = {};
  for (const name of allowedTools) {
    if (allTools[name]) {
      filtered[name] = allTools[name];
    }
  }
  return filtered;
}

export function createTaskTool(config: TaskToolConfig) {
  const {
    model: defaultModel,
    tools: allTools,
    subagentTypes = {},
    costPerInputToken = 0.000003, // Default Claude Sonnet pricing
    costPerOutputToken = 0.000015,
  } = config;

  return tool({
    description:
      "Launches a new agent to handle complex, multi-step tasks autonomously. Use this for tasks that require multiple steps, research, or specialized expertise.",
    inputSchema: zodSchema(taskInputSchema),
    execute: async ({
      description: _description,
      prompt,
      subagent_type,
    }: TaskInput): Promise<TaskOutput | TaskError> => {
      const startTime = performance.now();

      try {
        // Get config for this subagent type
        const typeConfig = subagentTypes[subagent_type] || {};

        const model = typeConfig.model || defaultModel;
        const tools = filterTools(allTools, typeConfig.tools);
        const systemPrompt = typeConfig.systemPrompt;

        // Spawn the sub-agent
        const result = await generateText({
          model,
          tools,
          system: systemPrompt,
          prompt,
        });

        const durationMs = Math.round(performance.now() - startTime);

        // Calculate usage and cost
        const usage =
          result.usage.inputTokens !== undefined &&
          result.usage.outputTokens !== undefined
            ? {
                input_tokens: result.usage.inputTokens,
                output_tokens: result.usage.outputTokens,
              }
            : undefined;

        let totalCostUsd: number | undefined;
        if (usage) {
          totalCostUsd =
            usage.input_tokens * costPerInputToken +
            usage.output_tokens * costPerOutputToken;
        }

        return {
          result: result.text,
          usage,
          total_cost_usd: totalCostUsd,
          duration_ms: durationMs,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
