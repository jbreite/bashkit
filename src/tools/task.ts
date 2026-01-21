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
import {
  debugEnd,
  debugError,
  debugStart,
  isDebugEnabled,
  popParent,
  pushParent,
} from "../utils/debug";

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
  system_prompt: z
    .string()
    .optional()
    .describe(
      "Optional custom system prompt for this agent. If provided, overrides the default system prompt for the subagent type. Use this to create dynamic, specialized agents on the fly.",
    ),
  tools: z
    .array(z.string())
    .optional()
    .describe(
      "Optional list of tool names this agent can use (e.g., ['Read', 'Grep', 'WebSearch']). If provided, overrides the default tools for the subagent type. Use this to restrict or expand the agent's capabilities.",
    ),
});

type TaskInput = z.infer<typeof taskInputSchema>;

const TASK_DESCRIPTION = `Launch a new agent to handle complex, multi-step tasks autonomously.

The Task tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

**Subagent types:**
- Use predefined subagent_type values for common task patterns
- For dynamic agents: provide custom system_prompt and/or tools to create a specialized agent on the fly

**When NOT to use the Task tool:**
- If you want to read a specific file path, use the Read or Glob tool instead, to find the match more quickly
- If you are searching for a specific class definition like "class Foo", use the Glob tool instead, to find the match more quickly
- If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead, to find the match more quickly
- Other tasks that are not related to the available agent types

**Usage notes:**
- Always include a short description (3-5 words) summarizing what the agent will do
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.
- Provide clear, detailed prompts so the agent can work autonomously and return exactly the information you need.
- The agent's outputs should generally be trusted
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent
- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.`;

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
  /** Stop condition(s) for this subagent (default: stepCountIs(15)). Can be a single condition or array - stops when ANY condition is met. */
  stopWhen?: StopCondition<ToolSet> | StopCondition<ToolSet>[];
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
  /** Default stop condition(s) for subagents (default: stepCountIs(15)). Can be a single condition or array - stops when ANY condition is met. */
  defaultStopWhen?: StopCondition<ToolSet> | StopCondition<ToolSet>[];
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

export function createTaskTool(
  config: TaskToolConfig,
): Tool<TaskInput, TaskOutput | TaskError> {
  const {
    model: defaultModel,
    tools: allTools,
    subagentTypes = {},
    defaultStopWhen,
    defaultOnStepFinish,
    streamWriter,
  } = config;

  return tool({
    description: TASK_DESCRIPTION,
    inputSchema: zodSchema(taskInputSchema),
    execute: async ({
      description,
      prompt,
      subagent_type,
      system_prompt,
      tools: customTools,
    }: TaskInput): Promise<TaskOutput | TaskError> => {
      const startTime = performance.now();
      const debugId = isDebugEnabled()
        ? debugStart("task", {
            subagent_type,
            description,
            tools:
              customTools ??
              subagentTypes[subagent_type]?.tools ??
              Object.keys(allTools),
          })
        : "";

      // Push this task as parent context for child tool calls
      if (debugId) pushParent(debugId);

      try {
        // Get config for this subagent type
        const typeConfig = subagentTypes[subagent_type] || {};

        const model = typeConfig.model || defaultModel;
        // Custom tools override the type's default tools
        const tools = filterTools(allTools, customTools ?? typeConfig.tools);
        // Custom system_prompt overrides the type's default
        const systemPrompt = system_prompt ?? typeConfig.systemPrompt;

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

          // Pop parent context and emit debug end
          if (debugId) {
            popParent();
            debugEnd(debugId, "task", {
              summary: {
                tokens: {
                  input: usage.inputTokens,
                  output: usage.outputTokens,
                },
                steps: response.messages?.length,
              },
              duration_ms: durationMs,
            });
          }

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

        // Pop parent context and emit debug end
        if (debugId) {
          popParent();
          debugEnd(debugId, "task", {
            summary: {
              tokens: {
                input: result.usage.inputTokens,
                output: result.usage.outputTokens,
              },
              steps: result.steps?.length,
            },
            duration_ms: durationMs,
          });
        }

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

        // Pop parent context and emit debug error
        if (debugId) {
          popParent();
          debugError(debugId, "task", errorMessage);
        }

        return { error: errorMessage };
      }
    },
  });
}
