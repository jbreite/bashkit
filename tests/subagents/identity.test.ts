import { describe, expect, it, beforeEach } from "vitest";
import {
  createSubagentId,
  resetSubagentIdCounterForTests,
} from "@/subagents/identity";

describe("subagent identity", () => {
  beforeEach(() => resetSubagentIdCounterForTests());

  it("generates stable unique ids", () => {
    expect(createSubagentId()).toBe("agent_1");
    expect(createSubagentId()).toBe("agent_2");
  });

  it("supports custom prefixes", () => {
    expect(createSubagentId("message")).toBe("message_1");
  });
});
