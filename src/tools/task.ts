import {
  generateText,
  type LanguageModel,
  type PrepareStepFunction,
  type StepResult,
  type StopCondition,
  stepCountIs,
  type Tool,
  type ToolSet,
  tool,
  zodSchema,
} from "ai";
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

/** Event emitted for each step a subagent takes */
export interface SubagentStepEvent {
  subagentType: string;
  description: string;
  step: StepResult<ToolSet>;
}

export interface SubagentTypeConfig {
  /** Model to use for this subagent type */
  model?: LanguageModel;
  /** System prompt for this subagent type */
  systemPrompt?: string;
  /** Tool names this subagent can use (filters from parent tools) */
  tools?: string[];
  /** Stop condition for this subagent (default: stepCountIs(15)) */
  stopWhen?: StopCondition<ToolSet>;
  /** Prepare step callback for dynamic control per step */
  prepareStep?: PrepareStepFunction<ToolSet>;
  /** Callback for each step this subagent takes */
  onStepFinish?: (step: StepResult<ToolSet>) => void | Promise<void>;
}

export interface TaskToolConfig {
  /** Default model for subagents */
  model: LanguageModel;
  /** All available tools that subagents can use */
  tools: ToolSet;
  /** Configuration for each subagent type */
  subagentTypes?: Record<string, SubagentTypeConfig>;
  /** Cost per input token for usage tracking */
  costPerInputToken?: number;
  /** Cost per output token for usage tracking */
  costPerOutputToken?: number;
  /** Default stop condition for subagents (default: stepCountIs(15)) */
  defaultStopWhen?: StopCondition<ToolSet>;
  /** Default callback for each step any subagent takes */
  defaultOnStepFinish?: (event: SubagentStepEvent) => void | Promise<void>;
}

function filterTools(allTools: ToolSet, allowedTools?: string[]): ToolSet {
  if (!allowedTools) return allTools;

  const filtered: ToolSet = {};
  for (const name of allowedTools) {
    if (allTools[name]) {
      filtered[name] = allTools[name];
    }
  }
  return filtered;
}

export function createTaskTool(config: TaskToolConfig): Tool {
  const {
    model: defaultModel,
    tools: allTools,
    subagentTypes = {},
    costPerInputToken = 0.000003, // Default Claude Sonnet pricing
    costPerOutputToken = 0.000015,
    defaultStopWhen,
    defaultOnStepFinish,
  } = config;

  return tool({
    description:
      "Launches a new agent to handle complex, multi-step tasks autonomously. Use this for tasks that require multiple steps, research, or specialized expertise.",
    inputSchema: zodSchema(taskInputSchema),
    execute: async ({
      description,
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

        // Spawn the sub-agent with loop control
        const result = await generateText({
          model,
          tools,
          system: systemPrompt,
          prompt,
          // Loop control
          stopWhen: typeConfig.stopWhen ?? defaultStopWhen ?? stepCountIs(15),
          prepareStep: typeConfig.prepareStep,
          onStepFinish: async (step) => {
            // Call subagent-specific callback
            await typeConfig.onStepFinish?.(step);
            // Call default callback with subagent context
            await defaultOnStepFinish?.({
              subagentType: subagent_type,
              description,
              step,
            });
          },
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
