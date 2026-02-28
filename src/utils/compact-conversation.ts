import {
  generateText,
  type LanguageModel,
  type ModelMessage,
  type PrepareStepFunction,
  type ToolSet,
} from "ai";
import { estimateMessagesTokens } from "./prune-messages";
import { getContextStatus } from "./context-status";

export class CompactionError extends Error {
  override readonly name = "CompactionError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

interface FileOperations {
  read: Set<string>;
  modified: Set<string>;
}

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
  /** Extra instructions for the summarizer (e.g., "Focus on database schema decisions") */
  summaryInstructions?: string;
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
  // Note: This re-estimates tokens even when called from createAutoCompaction
  // (which already estimated via getContextStatus). This is intentional — the
  // cost is negligible compared to the generateText call that follows, and
  // keeping compactConversation self-contained avoids coupling to callers.
  const currentTokens = estimateMessagesTokens(messages);
  const threshold = config.compactionThreshold ?? 0.85;
  const limit = config.maxTokens * threshold;

  // Under limit - no action needed
  if (currentTokens < limit) {
    return { messages, state, didCompact: false };
  }

  // Split messages at a safe point that won't orphan tool results
  const protectCount = config.protectRecentMessages ?? 10;
  const splitAt = findSafeSplitIndex(messages, protectCount);
  const oldMessages = messages.slice(0, splitAt);
  const recentMessages = messages.slice(splitAt);

  // Nothing to summarize
  if (oldMessages.length === 0) {
    return { messages, state, didCompact: false };
  }

  // Extract file operations from old messages for the summary
  const fileOps = extractFileOps(oldMessages);

  // Summarize old portion (the prompt includes previous summary as context)
  const newSummary = await summarizeMessages(
    oldMessages,
    config.summarizerModel,
    config.taskContext,
    state.conversationSummary,
    fileOps,
    config.summaryInstructions,
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

{{FILE_OPERATIONS}}

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
{{SUMMARY_INSTRUCTIONS}}</instructions>`;

async function summarizeMessages(
  messages: ModelMessage[],
  model: LanguageModel,
  taskContext?: string,
  previousSummary?: string,
  fileOps?: FileOperations,
  summaryInstructions?: string,
): Promise<string> {
  let fileOpsBlock = "";
  if (fileOps) {
    const MAX_FILES = 50;
    const sanitize = (p: string) => p.replace(/[<>&]/g, "");
    const readFiles = [...fileOps.read].sort().map(sanitize);
    const modifiedFiles = [...fileOps.modified].sort().map(sanitize);

    const sections: string[] = [];
    if (readFiles.length > 0) {
      const listed = readFiles.slice(0, MAX_FILES);
      sections.push(`Read: ${listed.join(", ")}`);
      if (readFiles.length > MAX_FILES) {
        sections.push(
          `... and ${readFiles.length - MAX_FILES} more read files`,
        );
      }
    }
    if (modifiedFiles.length > 0) {
      const listed = modifiedFiles.slice(0, MAX_FILES);
      sections.push(`Modified: ${listed.join(", ")}`);
      if (modifiedFiles.length > MAX_FILES) {
        sections.push(
          `... and ${modifiedFiles.length - MAX_FILES} more modified files`,
        );
      }
    }
    if (sections.length > 0) {
      fileOpsBlock = `<file-operations>\n${sections.join("\n")}\n</file-operations>`;
    }
  }

  const prompt = SUMMARIZATION_PROMPT.replace(
    "{{TASK_CONTEXT}}",
    taskContext || "Not specified",
  )
    .replace(
      "{{PREVIOUS_SUMMARY}}",
      previousSummary || "None - this is the first compaction",
    )
    .replace("{{CONVERSATION}}", formatMessagesForSummary(messages))
    .replace("{{FILE_OPERATIONS}}", fileOpsBlock)
    .replace(
      "{{SUMMARY_INSTRUCTIONS}}",
      summaryInstructions ? `- ${summaryInstructions}` : "",
    );

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

const MAX_PART_LENGTH = 500;

function truncate(str: string, max: number = MAX_PART_LENGTH): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max)}... [truncated]`;
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
            if (isToolCallPart(part)) {
              const argsStr = truncate(JSON.stringify(part.args));
              return `[Tool Call: ${part.toolName}]\nArgs: ${argsStr}`;
            }
            if ("result" in part) {
              const resultStr =
                typeof part.result === "string"
                  ? part.result
                  : JSON.stringify(part.result);
              return `[Tool Result]\n${truncate(resultStr)}`;
            }
            return truncate(JSON.stringify(part));
          })
          .join("\n\n");

        return `<message index="${index}" role="${role}">\n${parts}\n</message>`;
      }

      return `<message index="${index}" role="${role}">\n${truncate(
        JSON.stringify(msg.content),
      )}\n</message>`;
    })
    .join("\n\n");
}

function isToolCallPart(
  part: unknown,
): part is { toolName: string; args: unknown } {
  return (
    typeof part === "object" &&
    part !== null &&
    "toolName" in part &&
    "args" in part
  );
}

/**
 * Check if an assistant message contains tool calls in its content.
 */
function hasToolCalls(message: ModelMessage): boolean {
  if (message.role !== "assistant" || !Array.isArray(message.content)) {
    return false;
  }
  return message.content.some(isToolCallPart);
}

/**
 * Find a safe index to split messages that won't orphan tool results from their calls.
 *
 * Starts at the naive split point (messages.length - protectCount) and walks
 * backwards to avoid splitting inside a tool call/result pair.
 */
function findSafeSplitIndex(
  messages: ModelMessage[],
  protectCount: number,
): number {
  const naiveSplit = Math.max(0, messages.length - protectCount);
  let splitAt = naiveSplit;

  // Walk backwards to find a safe boundary
  while (splitAt > 0) {
    const msg = messages[splitAt];
    // Don't split at a tool result — it needs its preceding assistant message
    if (msg.role === "tool") {
      splitAt--;
      continue;
    }
    // If the previous message is an assistant with tool calls,
    // the tool results at splitAt+ would be orphaned
    const prev = messages[splitAt - 1];
    if (prev?.role === "assistant" && hasToolCalls(prev)) {
      splitAt--;
      continue;
    }
    break;
  }

  // If backward walk hit 0 (all tool pairs), walk forward from naive split
  // to find the first safe boundary instead of giving up entirely
  if (splitAt === 0 && naiveSplit > 0) {
    splitAt = naiveSplit;
    while (splitAt < messages.length) {
      const msg = messages[splitAt];
      if (msg.role !== "tool") {
        const prev = messages[splitAt - 1];
        if (!prev || prev.role !== "assistant" || !hasToolCalls(prev)) {
          break;
        }
      }
      splitAt++;
    }
    // If we walked past the end, fall back to naive split —
    // some orphaning is better than no compaction
    if (splitAt >= messages.length) {
      splitAt = naiveSplit;
    }
  }

  return splitAt;
}

/**
 * Extract file paths touched by tool calls in the conversation.
 *
 * Walks through assistant messages looking for tool call content parts
 * and maps tool names to read/written/edited operations.
 */
function extractFileOps(messages: ModelMessage[]): FileOperations {
  const ops: FileOperations = {
    read: new Set(),
    modified: new Set(),
  };

  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if (!isToolCallPart(part)) continue;

      const toolName = String(part.toolName).toLowerCase();
      const rawArgs = part.args;
      if (typeof rawArgs !== "object" || rawArgs === null) continue;
      const args = rawArgs as Record<string, unknown>;

      switch (toolName) {
        case "read": {
          const filePath = args.file_path;
          if (typeof filePath === "string") ops.read.add(filePath);
          break;
        }
        case "write":
        case "edit": {
          const filePath = args.file_path;
          if (typeof filePath === "string") ops.modified.add(filePath);
          break;
        }
      }
    }
  }

  return ops;
}

/**
 * Create an auto-compaction helper that integrates with the AI SDK's `prepareStep` hook.
 *
 * Returns a `prepareStep` function that monitors context usage and automatically
 * compacts the conversation when the threshold is exceeded.
 *
 * @example
 * ```typescript
 * import { createAutoCompaction } from 'bashkit';
 *
 * const compaction = createAutoCompaction({
 *   maxTokens: 200_000,
 *   summarizerModel: anthropic('claude-haiku-4'),
 *   taskContext: 'Building a REST API',
 * });
 *
 * const result = await generateText({
 *   model: anthropic('claude-sonnet-4-5'),
 *   tools,
 *   messages,
 *   prepareStep: compaction.prepareStep,
 *   stopWhen: stepCountIs(20),
 * });
 * ```
 */
export function createAutoCompaction(config: CompactConversationConfig): {
  prepareStep: PrepareStepFunction<ToolSet>;
  getState: () => Readonly<CompactConversationState>;
} {
  const state: CompactConversationState = { conversationSummary: "" };
  const threshold = config.compactionThreshold ?? 0.85;

  const prepareStep: PrepareStepFunction<ToolSet> = async (args) => {
    const status = getContextStatus(args.messages, config.maxTokens, {
      criticalThreshold: threshold,
    });

    if (status.status !== "critical") {
      return {};
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await compactConversation(args.messages, config, state);
        if (result.didCompact) {
          state.conversationSummary = result.state.conversationSummary;
          return { messages: result.messages };
        }
        // didCompact was false — no point retrying
        return {};
      } catch (err) {
        lastError = err;
      }
    }

    throw new CompactionError(
      "Conversation compaction failed after 2 attempts",
      { cause: lastError },
    );
  };

  return { prepareStep, getState: () => ({ ...state }) };
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
