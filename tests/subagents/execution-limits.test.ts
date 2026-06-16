import { describe, expect, it } from "vitest";
import {
  clampSubagentWaitTimeout,
  checkSubagentExecutionLimits,
  DEFAULT_SUBAGENT_COST_POLICY,
} from "@/subagents";

describe("subagent execution limits", () => {
  it("rejects active-agent limit exhaustion", () => {
    expect(
      checkSubagentExecutionLimits(DEFAULT_SUBAGENT_COST_POLICY, {
        activeAgents: 4,
        totalAgents: 4,
        depth: 0,
        mailboxMessages: 0,
      }),
    ).toEqual({ error: "Subagent active limit reached (4)" });
  });

  it("rejects depth limit exhaustion", () => {
    expect(
      checkSubagentExecutionLimits(DEFAULT_SUBAGENT_COST_POLICY, {
        activeAgents: 0,
        totalAgents: 0,
        depth: 3,
        mailboxMessages: 0,
      }),
    ).toEqual({ error: "Subagent depth limit reached (2)" });
  });

  it("clamps wait timeouts", () => {
    expect(clampSubagentWaitTimeout(1, DEFAULT_SUBAGENT_COST_POLICY)).toBe(100);
    expect(clampSubagentWaitTimeout(60_000, DEFAULT_SUBAGENT_COST_POLICY)).toBe(
      30_000,
    );
  });
});
