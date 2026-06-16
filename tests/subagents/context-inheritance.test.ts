import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { buildSubagentMessages, inheritSubagentMessages } from "@/subagents";

const parentMessages: ModelMessage[] = [
  { role: "user", content: "first task" },
  { role: "assistant", content: "first answer" },
  { role: "user", content: "second task" },
  { role: "assistant", content: "second answer" },
  { role: "user", content: "third task" },
];

describe("subagent context inheritance", () => {
  it("excludes parent history for none policy", () => {
    expect(
      buildSubagentMessages({
        parentMessages,
        policy: { mode: "none" },
        task: "child task",
      }),
    ).toEqual([{ role: "user", content: "child task" }]);
  });

  it("includes all parent history for all policy", () => {
    expect(
      buildSubagentMessages({
        parentMessages,
        policy: { mode: "all" },
        task: "child task",
      }),
    ).toEqual([...parentMessages, { role: "user", content: "child task" }]);
  });

  it("includes only recent user turns for recent policy", () => {
    expect(
      inheritSubagentMessages(parentMessages, { mode: "recent", turns: 2 }),
    ).toEqual(parentMessages.slice(2));
  });

  it("supports zero recent turns", () => {
    expect(
      inheritSubagentMessages(parentMessages, { mode: "recent", turns: 0 }),
    ).toEqual([]);
  });
});
