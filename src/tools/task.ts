import {
  generateText,
  streamText,
  type ModelMessage,
  type LanguageModel,
  type PrepareStepFunction,
  type StepResult,
  type StopCondition,
  type UIMessageStreamWriter,
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
  duration_ms?: number;
  subagent?: string;
  description?: string;
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

/** Data format for streamed subagent events (appears in message.parts as type: "data-subagent") */
export interface SubagentEventData {
  event: "start" | "tool-call" | "done" | "complete";
  subagent: string;
  description: string;
  toolName?: string;
  args?: Record<string, unknown>;
  messages?: ModelMessage[]; // Only present on "complete" event
}

let eventCounter = 0;
function generateEventId(): string {
  return `subagent-${Date.now()}-${++eventCounter}`;
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
  /** Default stop condition for subagents (default: stepCountIs(15)) */
  defaultStopWhen?: StopCondition<ToolSet>;
  /** Default callback for each step any subagent takes */
  defaultOnStepFinish?: (event: SubagentStepEvent) => void | Promise<void>;
  /** Optional stream writer for real-time subagent activity (uses streamText instead of generateText) */
  streamWriter?: UIMessageStreamWriter;
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
    defaultStopWhen,
    defaultOnStepFinish,
    streamWriter,
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

        // Common options for both generateText and streamText
        const commonOptions = {
          model,
          tools,
          system: systemPrompt,
          prompt,
          stopWhen: typeConfig.stopWhen ?? defaultStopWhen ?? stepCountIs(15),
          prepareStep: typeConfig.prepareStep,
        };

        // Use streamText if streamWriter is provided, otherwise generateText
        if (streamWriter) {
          // Emit start event
          const startId = generateEventId();
          streamWriter.write({
            type: "data-subagent",
            id: startId,
            data: {
              event: "start",
              subagent: subagent_type,
              description,
            } satisfies SubagentEventData,
          });

          const result = streamText({
            ...commonOptions,
            onStepFinish: async (step) => {
              // Stream tool calls
              if (step.toolCalls?.length) {
                for (const tc of step.toolCalls) {
                  const eventId = generateEventId();
                  streamWriter.write({
                    type: "data-subagent",
                    id: eventId,
                    data: {
                      event: "tool-call",
                      subagent: subagent_type,
                      description,
                      toolName: tc.toolName,
                      args: tc.input as Record<string, unknown>,
                    } satisfies SubagentEventData,
                  });
                }
              }
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

          // Wait for stream to complete
          const text = await result.text;
          const usage = await result.usage;
          const response = await result.response;

          // Emit done event
          streamWriter.write({
            type: "data-subagent",
            id: generateEventId(),
            data: {
              event: "done",
              subagent: subagent_type,
              description,
            } satisfies SubagentEventData,
          });

          // Emit complete event with full messages for UI access
          streamWriter.write({
            type: "data-subagent",
            id: generateEventId(),
            data: {
              event: "complete",
              subagent: subagent_type,
              description,
              messages: response.messages,
            } satisfies SubagentEventData,
          });

          const durationMs = Math.round(performance.now() - startTime);

          return {
            result: text,
            usage:
              usage.inputTokens !== undefined &&
              usage.outputTokens !== undefined
                ? {
                    input_tokens: usage.inputTokens,
                    output_tokens: usage.outputTokens,
                  }
                : undefined,
            duration_ms: durationMs,
            subagent: subagent_type,
            description,
          };
        }

        // Default: use generateText (no streaming)
        const result = await generateText({
          ...commonOptions,
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

        // Format usage
        const usage =
          result.usage.inputTokens !== undefined &&
          result.usage.outputTokens !== undefined
            ? {
                input_tokens: result.usage.inputTokens,
                output_tokens: result.usage.outputTokens,
              }
            : undefined;

        return {
          result: result.text,
          usage,
          duration_ms: durationMs,
          subagent: subagent_type,
          description,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        return { error: errorMessage };
      }
    },
  });
}
