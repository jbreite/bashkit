import type { PlanModeState } from "../tools/enter-plan-mode";
import type { ContextLayer } from "./index";

export interface ExecutionPolicyConfig {
  /** Tools that are blocked when plan mode is active. Default: ["Bash", "Write", "Edit"] */
  planModeBlockedTools?: string[];
  /** Custom predicate for blocking tools. Return error string to reject. */
  shouldBlock?: (
    toolName: string,
    params: Record<string, unknown>,
  ) => string | undefined;
}

const DEFAULT_PLAN_MODE_BLOCKED = ["Bash", "Write", "Edit"];

/**
 * Create an execution policy context layer that gates tool execution
 * based on plan mode state and optional custom predicates.
 *
 * When plan mode is active, blocked tools return an error instead of executing.
 * All tools remain registered (prompt cache stable) — only execution is gated.
 */
export function createExecutionPolicy(
  planModeState: PlanModeState,
  config?: ExecutionPolicyConfig,
): ContextLayer {
  const blocked = new Set(
    config?.planModeBlockedTools ?? DEFAULT_PLAN_MODE_BLOCKED,
  );

  return {
    beforeExecute: (toolName, params) => {
      // Plan mode gate
      if (planModeState.isActive && blocked.has(toolName)) {
        return {
          error: `${toolName} is not available in plan mode. Use read-only tools (Read, Grep, Glob) to gather information, then call ExitPlanMode when your plan is ready.`,
        };
      }

      // Custom gate
      if (config?.shouldBlock) {
        const reason = config.shouldBlock(toolName, params);
        if (reason) return { error: reason };
      }

      return undefined;
    },
  };
}
