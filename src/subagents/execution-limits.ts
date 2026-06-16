import type {
  SubagentCostPolicy,
  SubagentError,
  SubagentPolicyState,
} from "./types";

export function checkSubagentExecutionLimits(
  policy: SubagentCostPolicy,
  state: SubagentPolicyState,
): SubagentError | null {
  if (state.activeAgents >= policy.maxActiveAgents) {
    return {
      error: `Subagent active limit reached (${policy.maxActiveAgents})`,
    };
  }
  if (state.totalAgents >= policy.maxTotalAgents) {
    return { error: `Subagent total limit reached (${policy.maxTotalAgents})` };
  }
  if (state.depth > policy.maxDepth) {
    return { error: `Subagent depth limit reached (${policy.maxDepth})` };
  }
  if (state.mailboxMessages >= policy.maxMailboxMessages) {
    return {
      error: `Subagent mailbox limit reached (${policy.maxMailboxMessages})`,
    };
  }
  return null;
}

export function clampSubagentWaitTimeout(
  timeoutMs: number | null | undefined,
  policy: SubagentCostPolicy,
): number {
  const requested = timeoutMs ?? policy.maxWaitTimeoutMs;
  return Math.min(
    policy.maxWaitTimeoutMs,
    Math.max(policy.minWaitTimeoutMs, requested),
  );
}
