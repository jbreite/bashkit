import { describe, expect, it } from "vitest";
import { tool, zodSchema, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  createSubagentProfileRegistry,
  createSubagentToolSurface,
  type ResolvedSubagentProfile,
  type SubagentProfileInput,
} from "@/subagents";
import type { CodemodeConfig, CodemodeToolProvider } from "@/tools/codemode";
import { executeTool } from "../helpers/tool-executor";

function fakeTool(name: string): Tool {
  return tool({
    description: name,
    inputSchema: zodSchema(z.object({})),
    execute: async () => ({ ok: true }),
  });
}

function resolveProfile(
  overrides: Omit<SubagentProfileInput, "name">,
): ResolvedSubagentProfile {
  const registry = createSubagentProfileRegistry({
    profiles: [{ name: "test", ...overrides }],
  });
  const profile = registry.resolve("test");
  if ("error" in profile) throw new Error(profile.error);
  return profile;
}

function codemodeConfig(captured: {
  providers: CodemodeToolProvider[];
}): CodemodeConfig {
  return {
    executor: {
      execute: async () => ({ result: null }),
    },
    createCodeTool: async ({ tools }) => {
      if (!Array.isArray(tools)) throw new Error("expected providers");
      captured.providers = tools;
      return fakeTool("codemode");
    },
  };
}

describe("createSubagentToolSurface", () => {
  it("exposes Codemode by default and hides direct tools", async () => {
    const captured = { providers: [] as CodemodeToolProvider[] };
    const surface = await createSubagentToolSurface({
      tools: {
        Read: fakeTool("Read"),
        Write: fakeTool("Write"),
      },
      profile: resolveProfile({}),
      config: { codemode: codemodeConfig(captured) },
    });

    expect(Object.keys(surface.tools)).toEqual(["codemode"]);
    expect(surface.codemode?.name).toBe("codemode");
    expect(Object.keys(surface.directTools)).toEqual([]);
    expect(Object.keys(captured.providers[0].tools)).toEqual(["Read", "Write"]);
  });

  it("exposes direct tools only when profile opts in", async () => {
    const surface = await createSubagentToolSurface({
      tools: {
        Read: fakeTool("Read"),
        Grep: fakeTool("Grep"),
      },
      profile: resolveProfile({
        codemode: { enabled: false, exposeDirectTools: true },
      }),
    });

    expect(Object.keys(surface.tools).sort()).toEqual(["Grep", "Read"]);
    expect(surface.codemode).toBeNull();
  });

  it("applies profile quarantine to Codemode providers", async () => {
    const captured = { providers: [] as CodemodeToolProvider[] };
    await createSubagentToolSurface({
      tools: {
        Read: fakeTool("Read"),
        Bash: fakeTool("Bash"),
        Write: fakeTool("Write"),
      },
      profile: resolveProfile({
        allowedTools: ["Read", "Bash", "Write"],
        deniedTools: ["Bash"],
        codemode: { excludeTools: ["Write"] },
      }),
      config: { codemode: codemodeConfig(captured) },
    });

    expect(Object.keys(captured.providers[0].tools)).toEqual(["Read", "Bash"]);
    await expect(
      executeTool(captured.providers[0].tools.Bash, {}),
    ).resolves.toEqual({
      error: "Tool Bash is not allowed for subagent profile test",
    });
  });

  it("keeps denied direct tools present by default and rejects execution", async () => {
    const surface = await createSubagentToolSurface({
      tools: {
        Read: fakeTool("Read"),
        Bash: fakeTool("Bash"),
      },
      profile: resolveProfile({
        deniedTools: ["Bash"],
        codemode: { enabled: false, exposeDirectTools: true },
      }),
    });

    expect(Object.keys(surface.directTools)).toEqual(["Read", "Bash"]);
    await expect(executeTool(surface.directTools.Bash, {})).resolves.toEqual({
      error: "Tool Bash is not allowed for subagent profile test",
    });
  });

  it("uses allowedTools as the primary surface narrowing mechanism", async () => {
    const captured = { providers: [] as CodemodeToolProvider[] };
    const surface = await createSubagentToolSurface({
      tools: {
        Read: fakeTool("Read"),
        Bash: fakeTool("Bash"),
        Write: fakeTool("Write"),
      },
      profile: resolveProfile({
        allowedTools: ["Read"],
        deniedTools: ["Bash"],
        codemode: { exposeDirectTools: true },
      }),
      config: { codemode: codemodeConfig(captured) },
    });

    expect(Object.keys(surface.directTools)).toEqual(["Read"]);
    expect(Object.keys(captured.providers[0].tools)).toEqual(["Read"]);
  });

  it("hides denied direct and Codemode tools when configured", async () => {
    const captured = { providers: [] as CodemodeToolProvider[] };
    const surface = await createSubagentToolSurface({
      tools: {
        Read: fakeTool("Read"),
        Bash: fakeTool("Bash"),
      },
      profile: resolveProfile({
        deniedTools: ["Bash"],
        deniedBehavior: "hide",
        codemode: { exposeDirectTools: true },
      }),
      config: { codemode: codemodeConfig(captured) },
    });

    expect(Object.keys(surface.directTools)).toEqual(["Read"]);
    expect(Object.keys(captured.providers[0].tools)).toEqual(["Read"]);
  });
});
