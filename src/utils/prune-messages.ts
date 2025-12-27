import type { ModelMessage } from "ai";

export interface PruneMessagesConfig {
  /** Keep approximately this many tokens (default: 40000) */
  targetTokens?: number;
  /** Only prune if we'd save more than this many tokens (default: 20000) */
  minSavingsThreshold?: number;
  /** Always keep the last N user messages and their responses (default: 3) */
  protectLastNUserMessages?: number;
}

const DEFAULT_CONFIG: Required<PruneMessagesConfig> = {
  targetTokens: 40000,
  minSavingsThreshold: 20000,
  protectLastNUserMessages: 3,
};

/**
 * Estimate token count for a string (~4 chars per token for English)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate token count for a single message
 */
export function estimateMessageTokens(message: ModelMessage): number {
  let tokens = 0;

  if (typeof message.content === "string") {
    tokens += estimateTokens(message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (typeof part === "string") {
        tokens += estimateTokens(part);
      } else if ("text" in part && typeof part.text === "string") {
        tokens += estimateTokens(part.text);
      } else if ("result" in part) {
        // Tool result
        tokens += estimateTokens(JSON.stringify(part.result));
      } else if ("args" in part) {
        // Tool call
        tokens += estimateTokens(JSON.stringify(part.args));
      } else {
        // Fallback for other content types
        tokens += estimateTokens(JSON.stringify(part));
      }
    }
  }

  // Add overhead for role, etc.
  tokens += 4;

  return tokens;
}

/**
 * Estimate total token count for an array of messages
 */
export function estimateMessagesTokens(messages: ModelMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * Find indices of the last N user messages
 */
function findLastNUserMessageIndices(
  messages: ModelMessage[],
  n: number,
): Set<number> {
  const indices = new Set<number>();
  let count = 0;

  for (let i = messages.length - 1; i >= 0 && count < n; i--) {
    if (messages[i].role === "user") {
      indices.add(i);
      count++;
    }
  }

  return indices;
}

/**
 * Find indices of messages that should be protected
 * (last N user messages + all subsequent messages)
 */
function findProtectedIndices(
  messages: ModelMessage[],
  protectLastN: number,
): Set<number> {
  const userIndices = findLastNUserMessageIndices(messages, protectLastN);
  const protected_ = new Set<number>();

  if (userIndices.size === 0) return protected_;

  // Find the earliest protected user message
  const earliestProtected = Math.min(...userIndices);

  // Protect everything from that point onwards
  for (let i = earliestProtected; i < messages.length; i++) {
    protected_.add(i);
  }

  return protected_;
}

/**
 * Create a pruned version of a message by removing tool call details
 */
function pruneMessageContent(message: ModelMessage): ModelMessage {
  if (message.role !== "assistant" || typeof message.content === "string") {
    return message;
  }

  if (!Array.isArray(message.content)) {
    return message;
  }

  const prunedContent = message.content.map((part) => {
    if (typeof part === "object" && "toolName" in part && "args" in part) {
      // Tool call - keep name but truncate args
      return {
        ...part,
        args: { _pruned: true, toolName: part.toolName },
      };
    }
    return part;
  });

  return { ...message, content: prunedContent };
}

/**
 * Create a pruned version of a tool message by truncating results
 */
function pruneToolMessage(message: ModelMessage): ModelMessage {
  if (message.role !== "tool") {
    return message;
  }

  if (!Array.isArray(message.content)) {
    return message;
  }

  const prunedContent = message.content.map((part) => {
    if (typeof part === "object" && "result" in part) {
      return {
        ...part,
        result: { _pruned: true },
      };
    }
    return part;
  });

  return { ...message, content: prunedContent };
}

/**
 * Prune messages to fit within target token budget.
 *
 * Strategy: Remove tool call details and tool results from older messages,
 * keeping the conversation structure intact. Recent messages are protected.
 *
 * @param messages - Array of ModelMessage from the AI SDK
 * @param config - Pruning configuration
 * @returns Pruned messages array
 */
export function pruneMessagesByTokens(
  messages: ModelMessage[],
  config?: PruneMessagesConfig,
): ModelMessage[] {
  const { targetTokens, minSavingsThreshold, protectLastNUserMessages } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const totalTokens = estimateMessagesTokens(messages);
  const potentialSavings = totalTokens - targetTokens;

  // Don't prune if we wouldn't save enough
  if (potentialSavings <= minSavingsThreshold) {
    return messages;
  }

  // Find which messages to protect
  const protectedIndices = findProtectedIndices(
    messages,
    protectLastNUserMessages,
  );

  // Clone and prune messages from oldest to newest
  const prunedMessages: ModelMessage[] = [];
  let currentTokens = 0;
  let savedTokens = 0;

  // First pass: calculate what we'd have without pruning protected messages
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const isProtected = protectedIndices.has(i);

    if (isProtected) {
      // Always keep protected messages as-is
      prunedMessages.push(message);
      currentTokens += estimateMessageTokens(message);
    } else {
      // Check if we need to prune this message
      const originalTokens = estimateMessageTokens(message);

      if (currentTokens + originalTokens > targetTokens) {
        // Prune this message
        let prunedMessage = message;

        if (message.role === "assistant") {
          prunedMessage = pruneMessageContent(message);
        } else if (message.role === "tool") {
          prunedMessage = pruneToolMessage(message);
        }

        const prunedTokens = estimateMessageTokens(prunedMessage);
        savedTokens += originalTokens - prunedTokens;
        prunedMessages.push(prunedMessage);
        currentTokens += prunedTokens;
      } else {
        // Keep as-is
        prunedMessages.push(message);
        currentTokens += originalTokens;
      }
    }
  }

  return prunedMessages;
}
