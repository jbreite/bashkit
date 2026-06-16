import { describe, expect, it } from "vitest";
import { tool, zodSchema, type ToolSet } from "ai";
import { z } from "zod";
import { filterSubagentTools } from "@/subagents";
import { executeTool } from "../helpers/tool-executor";

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

  it("keeps denied tools visible by default and rejects execution", async () => {
    const filtered = filterSubagentTools(executableTools(), {
      allowedTools: ["Read", "Bash"],
      deniedTools: ["Bash"],
      profileName: "researcher",
    });

    expect(Object.keys(filtered)).toEqual(["Read", "Bash"]);
    await expect(executeTool(filtered.Bash, {})).resolves.toEqual({
      error: "Tool Bash is not allowed for subagent profile researcher",
    });
  });

  it("applies hide behavior after allowlist when explicitly configured", () => {
    const filtered = filterSubagentTools(executableTools(), {
      allowedTools: ["Read", "Bash"],
      deniedTools: ["Bash"],
      deniedBehavior: "hide",
    });

    expect(Object.keys(filtered)).toEqual(["Read"]);
  });
});
