import {
  generateText as aiGenerateText,
  stepCountIs,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type PrepareStepFunction,
  type StepResult,
  type StopCondition,
  type ToolSet,
} from "ai";
import type { CodemodeConfig } from "../tools/codemode";
import { buildSubagentMessages } from "./context-inheritance";
import { createSubagentToolSurface } from "./tool-surface";
import {
  compactSubagentResult,
  jsonObjectFromUnknown,
  summarizeSubagentTranscript,
} from "./transcripts";
import type {
  ResolvedSubagentRunRequest,
  SubagentError,
  SubagentInterruptResult,
  SubagentRunResult,
  SubagentRunner,
  SubagentUsage,
} from "./types";

export interface AiSdkSubagentRunnerConfig {
  model?: LanguageModel;
  codemode?: CodemodeConfig;
  stopWhen?: StopCondition<ToolSet> | StopCondition<ToolSet>[];
  prepareStep?: PrepareStepFunction<ToolSet>;
  generateText?: AiSdkSubagentGenerateText;
  maxResultLength?: number;
}

export type AiSdkSubagentGenerateText = (
  options: AiSdkSubagentGenerateOptions,
) => Promise<AiSdkSubagentGenerateResult>;

export interface AiSdkSubagentGenerateOptions {
  model: LanguageModel;
  tools: ToolSet;
  system?: string;
  messages: ModelMessage[];
  stopWhen?: StopCondition<ToolSet> | StopCondition<ToolSet>[];
  prepareStep?: PrepareStepFunction<ToolSet>;
  abortSignal?: AbortSignal;
  onStepFinish?: (step: StepResult<ToolSet>) => void | Promise<void>;
}

export type AiSdkSubagentGenerateResult = Pick<
  {
    text: string;
    usage: LanguageModelUsage;
    totalUsage: LanguageModelUsage;
    steps: StepResult<ToolSet>[];
  },
  "text" | "usage" | "totalUsage" | "steps"
> & {
  response?: {
    messages?: ModelMessage[];
  };
};

function usageFromLanguageModelUsage(
  usage: LanguageModelUsage | undefined,
): SubagentUsage {
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted")))
  );
}

async function defaultGenerateText(
  options: AiSdkSubagentGenerateOptions,
): Promise<AiSdkSubagentGenerateResult> {
  return aiGenerateText({
    ...options,
  });
}

async function reportStep(
  request: ResolvedSubagentRunRequest,
  step: StepResult<ToolSet>,
): Promise<void> {
  const usage = usageFromLanguageModelUsage(step.usage);
  await request.callbacks.onUsage(usage);

  for (const toolCall of step.toolCalls) {
    await request.callbacks.onEvent({
      type: "subagent.tool_call",
      agent_id: request.handle.agent_id,
      task_name: request.handle.task_name,
      parent_id: request.parent_id,
      profile: request.profile.name,
      status: "running",
      payload: {
        tool_name: toolCall.toolName,
        tool_call_id: toolCall.toolCallId,
        input: jsonObjectFromUnknown(toolCall.input),
      },
    });
  }

  for (const toolResult of step.toolResults) {
    await request.callbacks.onEvent({
      type: "subagent.tool_result",
      agent_id: request.handle.agent_id,
      task_name: request.handle.task_name,
      parent_id: request.parent_id,
      profile: request.profile.name,
      status: "running",
      payload: {
        tool_name: toolResult.toolName,
        tool_call_id: toolResult.toolCallId,
        output: jsonObjectFromUnknown(toolResult.output),
      },
    });
  }
}

export function createAiSdkSubagentRunner(
  config: AiSdkSubagentRunnerConfig = {},
): SubagentRunner {
  const activeRuns = new Map<string, AbortController>();
  const generate = config.generateText ?? defaultGenerateText;

  return {
    capabilities: {
      interrupt: true,
      followup: false,
    },

    async run(request: ResolvedSubagentRunRequest): Promise<SubagentRunResult> {
      const model = request.profile.model ?? config.model;
      if (!model) {
        return {
          agent_id: request.handle.agent_id,
          task_name: request.handle.task_name,
          status: "failed",
          error: "Subagent profile does not define a model",
        };
      }

      const abortController = new AbortController();
      const abortFromRequest = (): void => abortController.abort();
      if (request.signal?.aborted) abortController.abort();
      request.signal?.addEventListener("abort", abortFromRequest, {
        once: true,
      });
      activeRuns.set(request.handle.agent_id, abortController);

      try {
        await request.callbacks.onStatus("running");
        const toolSurface = await createSubagentToolSurface({
          tools: request.tools,
          profile: request.profile,
          config: { codemode: config.codemode },
        });
        const messages = buildSubagentMessages({
          parentMessages: request.messages,
          policy: request.profile.context,
          task: request.task,
        });

        const result = await generate({
          model,
          tools: toolSurface.tools,
          system: request.profile.system || undefined,
          messages,
          stopWhen: config.stopWhen ?? stepCountIs(15),
          prepareStep: config.prepareStep,
          abortSignal: abortController.signal,
          onStepFinish: async (step) => {
            await reportStep(request, step);
          },
        });
        const usage = usageFromLanguageModelUsage(
          result.totalUsage ?? result.usage,
        );
        await request.callbacks.onUsage(usage);

        const transcript = summarizeSubagentTranscript(
          request.handle,
          result.response?.messages,
        );

        return {
          agent_id: request.handle.agent_id,
          task_name: request.handle.task_name,
          status: "completed",
          result: compactSubagentResult(
            result.text,
            config.maxResultLength ?? 4000,
          ),
          usage,
          result_ref: transcript.result_ref,
          transcript_ref: transcript.transcript_ref,
          metadata: {
            message_count: transcript.message_count,
            step_count: result.steps.length,
          },
        };
      } catch (error) {
        if (isAbortError(error, abortController.signal)) {
          return {
            agent_id: request.handle.agent_id,
            task_name: request.handle.task_name,
            status: "interrupted",
            error: "Subagent interrupted",
          };
        }

        return {
          agent_id: request.handle.agent_id,
          task_name: request.handle.task_name,
          status: "failed",
          error: getErrorMessage(error),
        };
      } finally {
        request.signal?.removeEventListener("abort", abortFromRequest);
        activeRuns.delete(request.handle.agent_id);
      }
    },

    async interrupt(handle): Promise<SubagentInterruptResult | SubagentError> {
      const active = activeRuns.get(handle.agent_id);
      if (!active) return { error: "Subagent is not actively running" };

      active.abort();
      return {
        agent_id: handle.agent_id,
        previous_status: "running",
        status: "interrupted",
      };
    },
  };
}
