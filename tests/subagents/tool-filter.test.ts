import { describe, expect, it } from "vitest";
import { tool, zodSchema, type ToolSet } from "ai";
import { z } from "zod";
import { filterSubagentTools } from "@/subagents";

function executableTools(): ToolSet {
  const simpleTool = tool({
    description: "test",
    inputSchema: zodSchema(z.object({})),
    execute: async () => ({ ok: true }),
  });
  return {
    Read: simpleTool,
    Grep: simpleTool,
    Bash: simpleTool,
  };
}

describe("filterSubagentTools", () => {
  it("applies allowlists without mutating the original tool set", () => {
    const tools = executableTools();
    const filtered = filterSubagentTools(tools, {
      allowedTools: ["Read", "Grep"],
    });

    expect(Object.keys(filtered)).toEqual(["Read", "Grep"]);
    expect(Object.keys(tools)).toEqual(["Read", "Grep", "Bash"]);
  });

  it("applies denylist after allowlist", () => {
    const filtered = filterSubagentTools(executableTools(), {
      allowedTools: ["Read", "Bash"],
      deniedTools: ["Bash"],
    });

    expect(Object.keys(filtered)).toEqual(["Read"]);
  });
});
