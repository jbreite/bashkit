import type {
  PrepareStepFunction,
  PrepareStepResult,
  ToolSet,
  ModelMessage,
} from "ai";
import type { PlanModeState } from "../tools/enter-plan-mode";
import {
  createAutoCompaction,
  type CompactConversationConfig,
} from "../utils/compact-conversation";
import {
  getContextStatus,
  type ContextStatusConfig,
} from "../utils/context-status";

export interface PrepareStepConfig {
  /** Auto-compaction config. If provided, messages are compacted when threshold hit. */
  compaction?: CompactConversationConfig;
  /** Context status config. If provided, guidance injected at high/critical usage. */
  contextStatus?: {
    maxTokens: number;
    config?: ContextStatusConfig;
  };
  /** Plan mode state (for message-level hints — enforcement is via withContext) */
  planModeState?: PlanModeState;
  /** Custom prepareStep logic that runs after built-in logic */
  extend?: PrepareStepFunction<ToolSet>;
}

/**
 * Create a prepareStep callback that composes:
 * - Message compaction (auto-compact when threshold hit)
 * - Context status monitoring (guidance injection as user message)
 * - Plan mode hints (as user message, belt for withContext's suspenders)
 *
 * CRITICAL: Does NOT touch `system` prompt — system prompt is static
 * (set once in streamText({ system })) to preserve Anthropic prompt caching.
 * prepareStep only handles `messages`.
 *
 * Returns a PrepareStepFunction compatible with generateText/streamText.
 */
export function createPrepareStep(
  config: PrepareStepConfig,
): PrepareStepFunction<ToolSet> {
  const autoCompact = config.compaction
    ? createAutoCompaction(config.compaction)
    : null;

  return async (args) => {
    // 1. Message compaction (if configured)
    let effectiveMessages = args.messages;
    if (autoCompact) {
      const compactResult = await autoCompact.prepareStep(args);
      if (compactResult?.messages) {
        effectiveMessages = compactResult.messages as ModelMessage[];
      }
    }

    // 2. Context status monitoring — inject guidance as user message
    const injectedMessages: ModelMessage[] = [];
    if (config.contextStatus) {
      const status = getContextStatus(
        effectiveMessages,
        config.contextStatus.maxTokens,
        config.contextStatus.config,
      );
      if (status.guidance) {
        injectedMessages.push({
          role: "user" as const,
          content: `<context_status>${status.guidance}</context_status>`,
        });
      }
    }

    // 3. Plan mode hint as user message
    if (config.planModeState?.isActive) {
      injectedMessages.push({
        role: "user" as const,
        content:
          "<plan_mode>PLAN MODE ACTIVE — use read-only tools (Read, Grep, Glob) to gather information. Call ExitPlanMode when your plan is ready.</plan_mode>",
      });
    }

    // Build final messages
    const messagesChanged =
      effectiveMessages !== args.messages || injectedMessages.length > 0;
    const finalMessages = messagesChanged
      ? [...effectiveMessages, ...injectedMessages]
      : undefined;

    // 4. Let consumer extend
    const extended = config.extend
      ? await config.extend({
          ...args,
          messages: finalMessages ?? args.messages,
        })
      : undefined;

    const result: PrepareStepResult<ToolSet> = {
      ...extended,
    };

    if (finalMessages && !extended?.messages) {
      result.messages = finalMessages;
    }

    return result;
  };
}
