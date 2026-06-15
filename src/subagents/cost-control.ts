import type {
  SubagentCostPolicy,
  SubagentError,
  SubagentPolicyState,
} from "./types";
import { checkSubagentExecutionLimits } from "./execution-limits";

export function checkSubagentCostPolicy(
  policy: SubagentCostPolicy,
  state: SubagentPolicyState,
): SubagentError | null {
  const executionError = checkSubagentExecutionLimits(policy, state);
  if (executionError) return executionError;

  if (state.budgetStatus?.exceeded) {
    return { error: "Subagent budget is already exhausted" };
  }

  if (
    policy.maxUsd != null &&
    state.budgetStatus &&
    state.budgetStatus.totalCostUsd >= policy.maxUsd
  ) {
    return {
      error: `Subagent profile budget limit reached ($${policy.maxUsd})`,
    };
  }

  return null;
}
