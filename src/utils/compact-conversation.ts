import { generateText, type LanguageModel, type ModelMessage } from "ai";
import { estimateMessagesTokens } from "./prune-messages";

export interface CompactConversationConfig {
  /** Model's context limit (e.g., 200000 for Claude) */
  maxTokens: number;
  /** Trigger compaction at this % of maxTokens (default: 0.85) */
  compactionThreshold?: number;
  /** Keep last N messages intact (default: 10) */
  protectRecentMessages?: number;
  /** Model to use for summarization (use a fast/cheap model like Haiku) */
  summarizerModel: LanguageModel;
  /** The original task/goal the agent is working on - helps preserve context */
  taskContext?: string;
}

export interface CompactConversationState {
  /** Accumulated summary from previous compactions */
  conversationSummary: string;
}

export interface CompactConversationResult {
  /** Messages to use (unchanged if under limit, compacted if over) */
  messages: ModelMessage[];
  /** Updated state to pass to next call */
  state: CompactConversationState;
  /** Whether compaction occurred this call */
  didCompact: boolean;
}

/**
 * Compacts a conversation when it exceeds the token limit.
 *
 * When the conversation hits the threshold, it:
 * 1. Summarizes older messages using the summarizer model
 * 2. Keeps recent messages intact
 * 3. Returns a new conversation starting with the summary
 *
 * Use this alongside pruneMessagesByTokens:
 * - pruneMessagesByTokens: Fast pruning, loses context
 * - compactConversation: Preserves context via summarization
 *
 * @param messages - Current conversation messages
 * @param config - Compaction configuration
 * @param state - State from previous compaction (or empty for first call)
 * @returns Compacted messages, updated state, and whether compaction occurred
 *
 * @example
 * ```typescript
 * import { compactConversation } from 'bashkit';
 *
 * let messages: CoreMessage[] = [];
 * let compactState = { conversationSummary: '' };
 *
 * async function chat(userMessage: string) {
 *   messages.push({ role: 'user', content: userMessage });
 *
 *   const result = await compactConversation(messages, {
 *     maxTokens: 200_000,
 *     summarizerModel: anthropic('claude-haiku-4')
 *   }, compactState);
 *
 *   messages = result.messages;
 *   compactState = result.state;
 *
 *   // Continue with streamText using result.messages...
 * }
 * ```
 */
export async function compactConversation(
  messages: ModelMessage[],
  config: CompactConversationConfig,
  state: CompactConversationState = { conversationSummary: "" },
): Promise<CompactConversationResult> {
  const currentTokens = estimateMessagesTokens(messages);
  const threshold = config.compactionThreshold ?? 0.85;
  const limit = config.maxTokens * threshold;

  // Under limit - no action needed
  if (currentTokens < limit) {
    return { messages, state, didCompact: false };
  }

  // Split messages: old (to summarize) vs recent (to keep)
  const protectCount = config.protectRecentMessages ?? 10;
  const recentMessages = messages.slice(-protectCount);
  const oldMessages = messages.slice(0, -protectCount);

  // Nothing to summarize
  if (oldMessages.length === 0) {
    return { messages, state, didCompact: false };
  }

  // Summarize old portion (the prompt includes previous summary as context)
  const newSummary = await summarizeMessages(
    oldMessages,
    config.summarizerModel,
    config.taskContext,
    state.conversationSummary,
  );

  // Build compacted messages
  const compactedMessages: ModelMessage[] = [
    {
      role: "user",
      content: `[Previous conversation summary]\n\n${newSummary}\n\n[Continuing from recent messages below...]`,
    },
    // Add an assistant acknowledgment to maintain valid message structure
    {
      role: "assistant",
      content:
        "I understand the context from the previous conversation. Continuing from where we left off.",
    },
    ...recentMessages,
  ];

  return {
    messages: compactedMessages,
    state: { conversationSummary: newSummary },
    didCompact: true,
  };
}

const SUMMARIZATION_PROMPT = `<context>
You are a conversation summarizer for an AI coding agent. The agent has been working on a task and the conversation has grown too long to fit in context. Your job is to create a comprehensive summary that allows the conversation to continue seamlessly.
</context>

<task>
Create a structured summary of the conversation below. This summary will replace the old messages, so it MUST preserve all information needed to continue the work.
</task>

<original-goal>
{{TASK_CONTEXT}}
</original-goal>

<previous-summary>
{{PREVIOUS_SUMMARY}}
</previous-summary>

<conversation-to-summarize>
{{CONVERSATION}}
</conversation-to-summarize>

<output-format>
Structure your summary with these sections:

## Task Overview
Brief description of what the user asked for and the current goal.

## Progress Made
- What has been accomplished so far
- Key milestones reached

## Files & Code
- Files created: list with paths
- Files modified: list with paths and what changed
- Files read/analyzed: list with paths
- Key code patterns or architecture decisions

## Technical Decisions
- Important choices made and why
- Configurations or settings established
- Dependencies or tools being used

## Errors & Resolutions
- Problems encountered
- How they were solved (or if still unresolved)

## Current State
- Where the work left off
- What was being worked on when summarized
- Any pending questions or blockers

## Key Context
- Important facts, names, or values that must not be forgotten
- User preferences or requirements mentioned
</output-format>

<instructions>
- Be thorough. Missing information cannot be recovered.
- Preserve exact file paths, variable names, and code snippets where relevant.
- If tool calls were made, note what tools were used and their outcomes.
- Maintain the user's original terminology and naming.
- Do not editorialize or add suggestions - just capture what happened.
- Omit sections that have no relevant information.
</instructions>`;

async function summarizeMessages(
  messages: ModelMessage[],
  model: LanguageModel,
  taskContext?: string,
  previousSummary?: string,
): Promise<string> {
  const prompt = SUMMARIZATION_PROMPT.replace(
    "{{TASK_CONTEXT}}",
    taskContext || "Not specified",
  )
    .replace(
      "{{PREVIOUS_SUMMARY}}",
      previousSummary || "None - this is the first compaction",
    )
    .replace("{{CONVERSATION}}", formatMessagesForSummary(messages));

  const result = await generateText({
    model,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return result.text;
}

function formatMessagesForSummary(messages: ModelMessage[]): string {
  return messages
    .map((msg, index) => {
      const role = msg.role.toUpperCase();

      if (typeof msg.content === "string") {
        return `<message index="${index}" role="${role}">\n${msg.content}\n</message>`;
      }

      // Handle complex content (tool calls, tool results, etc.)
      if (Array.isArray(msg.content)) {
        const parts = msg.content
          .map((part) => {
            if (typeof part === "string") {
              return part;
            }
            if ("text" in part && typeof part.text === "string") {
              return part.text;
            }
            if ("toolName" in part && "args" in part) {
              return `[Tool Call: ${part.toolName}]\nArgs: ${JSON.stringify(
                part.args,
                null,
                2,
              )}`;
            }
            if ("result" in part) {
              const resultStr =
                typeof part.result === "string"
                  ? part.result
                  : JSON.stringify(part.result, null, 2);
              return `[Tool Result]\n${resultStr}`;
            }
            return JSON.stringify(part, null, 2);
          })
          .join("\n\n");

        return `<message index="${index}" role="${role}">\n${parts}\n</message>`;
      }

      return `<message index="${index}" role="${role}">\n${JSON.stringify(
        msg.content,
        null,
        2,
      )}\n</message>`;
    })
    .join("\n\n");
}

/**
 * Pre-configured token limits for common models.
 * Use these with compactConversation config.
 */
export const MODEL_CONTEXT_LIMITS = {
  // Claude models
  "claude-opus-4-5": 200_000,
  "claude-sonnet-4-5": 200_000,
  "claude-haiku-4": 200_000,
  // OpenAI models
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
  // Google models
  "gemini-2.5-pro": 1_000_000,
  "gemini-2.5-flash": 1_000_000,
} as const;

export type ModelContextLimit = keyof typeof MODEL_CONTEXT_LIMITS;

/**
 * Helper to create config with model preset
 */
export function createCompactConfig(
  modelId: ModelContextLimit,
  summarizerModel: LanguageModel,
  overrides?: Partial<Omit<CompactConversationConfig, "summarizerModel">>,
): CompactConversationConfig {
  const maxTokens = MODEL_CONTEXT_LIMITS[modelId];

  return {
    maxTokens,
    summarizerModel,
    ...overrides,
  };
}
