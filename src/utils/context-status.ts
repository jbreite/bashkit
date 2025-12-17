import type { ModelMessage } from "ai";
import { estimateMessagesTokens } from "./prune-messages";

export type ContextStatusLevel =
  | "comfortable"
  | "elevated"
  | "high"
  | "critical";

export interface ContextStatus {
  /** Estimated tokens used by current messages */
  usedTokens: number;
  /** Maximum tokens for the model */
  maxTokens: number;
  /** Usage as a decimal (0-1) */
  usagePercent: number;
  /** Usage level category */
  status: ContextStatusLevel;
  /** Optional guidance message to inject into the conversation */
  guidance?: string;
}

/** Base context metrics passed to custom guidance functions */
export interface ContextMetrics {
  usedTokens: number;
  maxTokens: number;
  usagePercent: number;
}

export interface ContextStatusConfig {
  /** Threshold for 'elevated' status (default: 0.5) */
  elevatedThreshold?: number;
  /** Threshold for 'high' status (default: 0.7) */
  highThreshold?: number;
  /** Threshold for 'critical' status (default: 0.85) */
  criticalThreshold?: number;
  /** Custom guidance message for 'high' status */
  highGuidance?: string | ((metrics: ContextMetrics) => string);
  /** Custom guidance message for 'critical' status */
  criticalGuidance?: string | ((metrics: ContextMetrics) => string);
}

const DEFAULT_CONFIG: Required<
  Omit<ContextStatusConfig, "highGuidance" | "criticalGuidance">
> = {
  elevatedThreshold: 0.5,
  highThreshold: 0.7,
  criticalThreshold: 0.85,
};

function defaultHighGuidance(metrics: ContextMetrics): string {
  const used = Math.round(metrics.usagePercent * 100);
  const remaining = Math.round((1 - metrics.usagePercent) * 100);
  return `Context usage: ${used}%. You still have ${remaining}% remaining—no need to rush. Continue working thoroughly.`;
}

function defaultCriticalGuidance(metrics: ContextMetrics): string {
  const used = Math.round(metrics.usagePercent * 100);
  return `Context usage: ${used}%. Consider wrapping up the current task or summarizing progress before continuing.`;
}

/**
 * Get the current context window status for a conversation.
 *
 * Use this to monitor context usage and optionally inject guidance
 * to prevent agents from rushing when context is filling up.
 *
 * @param messages - Current conversation messages
 * @param maxTokens - Maximum tokens for the model (use MODEL_CONTEXT_LIMITS)
 * @param config - Optional thresholds and custom guidance
 * @returns Context status with usage info and optional guidance message
 *
 * @example
 * ```typescript
 * import { getContextStatus, MODEL_CONTEXT_LIMITS } from '@jbreite/bashkit';
 *
 * const status = getContextStatus(messages, MODEL_CONTEXT_LIMITS['claude-sonnet-4-5']);
 *
 * if (status.guidance) {
 *   // Inject into system prompt or conversation
 *   system = `${system}\n\n<context_status>${status.guidance}</context_status>`;
 * }
 *
 * if (status.status === 'critical') {
 *   // Trigger compaction
 *   const compacted = await compactConversation(messages, config, state);
 * }
 * ```
 */
export function getContextStatus(
  messages: ModelMessage[],
  maxTokens: number,
  config?: ContextStatusConfig
): ContextStatus {
  const {
    elevatedThreshold,
    highThreshold,
    criticalThreshold,
  } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const usedTokens = estimateMessagesTokens(messages);
  const usagePercent = usedTokens / maxTokens;

  const baseStatus = { usedTokens, maxTokens, usagePercent };

  // Comfortable: plenty of room
  if (usagePercent < elevatedThreshold) {
    return { ...baseStatus, status: "comfortable" };
  }

  // Elevated: starting to fill up, no guidance needed yet
  if (usagePercent < highThreshold) {
    return { ...baseStatus, status: "elevated" };
  }

  // High: remind the agent not to rush
  if (usagePercent < criticalThreshold) {
    const guidance =
      typeof config?.highGuidance === "function"
        ? config.highGuidance(baseStatus)
        : config?.highGuidance ?? defaultHighGuidance(baseStatus);

    return { ...baseStatus, status: "high", guidance };
  }

  // Critical: should wrap up or compact
  const guidance =
    typeof config?.criticalGuidance === "function"
      ? config.criticalGuidance(baseStatus)
      : config?.criticalGuidance ?? defaultCriticalGuidance(baseStatus);

  return { ...baseStatus, status: "critical", guidance };
}

/**
 * Check if context status requires action (high or critical).
 * Convenience helper for conditional logic.
 */
export function contextNeedsAttention(status: ContextStatus): boolean {
  return status.status === "high" || status.status === "critical";
}

/**
 * Check if context should be compacted (critical status).
 * Convenience helper for triggering compaction.
 */
export function contextNeedsCompaction(status: ContextStatus): boolean {
  return status.status === "critical";
}
