import { describe, expect, it } from "vitest";
import {
  checkSubagentCostPolicy,
  DEFAULT_SUBAGENT_COST_POLICY,
} from "@/subagents";

describe("subagent cost control", () => {
  it("rejects exhausted root budget before spawn", () => {
    expect(
      checkSubagentCostPolicy(DEFAULT_SUBAGENT_COST_POLICY, {
        activeAgents: 0,
        totalAgents: 0,
        depth: 0,
        mailboxMessages: 0,
        budgetStatus: {
          totalCostUsd: 1,
          maxUsd: 1,
          remainingUsd: 0,
          usagePercent: 100,
          stepsCompleted: 1,
          exceeded: true,
          unpricedSteps: 0,
        },
      }),
    ).toEqual({ error: "Subagent budget is already exhausted" });
  });

  it("rejects per-profile budget caps", () => {
    expect(
      checkSubagentCostPolicy(
        { ...DEFAULT_SUBAGENT_COST_POLICY, maxUsd: 0.5 },
        {
          activeAgents: 0,
          totalAgents: 0,
          depth: 0,
          mailboxMessages: 0,
          budgetStatus: {
            totalCostUsd: 0.5,
            maxUsd: 5,
            remainingUsd: 4.5,
            usagePercent: 10,
            stepsCompleted: 1,
            exceeded: false,
            unpricedSteps: 0,
          },
        },
      ),
    ).toEqual({ error: "Subagent profile budget limit reached ($0.5)" });
  });
});
