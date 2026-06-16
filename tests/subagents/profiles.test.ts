import { describe, expect, it } from "vitest";
import {
  createSubagentProfileRegistry,
  describeSubagentProfile,
  resolveSubagentContextPolicy,
} from "@/subagents";

describe("createSubagentProfileRegistry", () => {
  it("resolves built-in worker profile defaults", () => {
    const registry = createSubagentProfileRegistry();
    const profile = registry.resolve(undefined);

    expect(profile).toMatchObject({
      name: "worker",
      nickname: "worker",
      codemode: { enabled: true, exposeDirectTools: false },
      deniedBehavior: "reject",
      context: { mode: "recent", turns: 3 },
    });
  });

  it("layers defaults, named profile config, and overrides", () => {
    const registry = createSubagentProfileRegistry({
      defaults: {
        allowedTools: ["Read", "Grep", "Bash"],
        deniedTools: ["Bash"],
        deniedBehavior: "hide",
        context: "none",
      },
      profiles: [
        {
          name: "researcher",
          description: "Read-only research",
          allowedTools: ["Glob"],
          codemode: { exposeDirectTools: true },
        },
      ],
    });

    const profile = registry.resolve("researcher", {
      allowedTools: ["WebSearch"],
      context: { recent_turns: 2 },
    });

    expect(profile).toMatchObject({
      name: "researcher",
      allowedTools: ["Read", "Grep", "Bash", "Glob", "WebSearch"],
      deniedTools: ["Bash"],
      deniedBehavior: "hide",
      codemode: { enabled: true, exposeDirectTools: true },
      context: { mode: "recent", turns: 2 },
    });
  });

  it("returns an error for unknown profiles", () => {
    const registry = createSubagentProfileRegistry();
    expect(registry.resolve("missing")).toEqual({
      error: "Unknown subagent profile: missing",
    });
  });

  it("validates recent-turn context", () => {
    expect(resolveSubagentContextPolicy({ recent_turns: -1 })).toEqual({
      error: "recent_turns must be a non-negative integer",
    });
  });

  it("generates profile descriptions from resolved config", () => {
    const registry = createSubagentProfileRegistry({
      profiles: [
        {
          name: "reviewer",
          description: "Review code",
          allowedTools: ["Read"],
          deniedTools: ["Write"],
          cost: { maxUsd: 1, maxDepth: 1 },
        },
      ],
    });
    const profile = registry.resolve("reviewer");
    if ("error" in profile) throw new Error(profile.error);

    expect(describeSubagentProfile(profile)).toContain("reviewer: Review code");
    expect(describeSubagentProfile(profile)).toContain("allowed tools: Read");
    expect(describeSubagentProfile(profile)).toContain("denied tools: Write");
    expect(describeSubagentProfile(profile)).toContain("budget cap: $1");
  });
});
