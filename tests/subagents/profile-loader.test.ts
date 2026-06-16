import { describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import {
  createSubagentProfileRegistry,
  loadSubagentProfilesFromFile,
  loadSubagentProfilesFromJson,
  loadSubagentProfilesFromObject,
} from "@/subagents";

function model(modelId: string): LanguageModel {
  return { modelId } as LanguageModel;
}

describe("subagent profile loader", () => {
  it("loads serialized profiles and resolves model aliases", () => {
    const fast = model("fast-model");
    const deep = model("deep-model");
    const result = loadSubagentProfilesFromObject(
      {
        defaultProfile: "researcher",
        defaults: {
          model: "fast",
          allowedTools: ["Read", "Grep"],
          deniedTools: ["Write"],
          codemode: { enabled: true },
          context: { recent_turns: 2 },
          cost: { maxActiveAgents: 2 },
        },
        profiles: [
          {
            name: "researcher",
            description: "Read-only research",
            nickname: "research",
            model: "deep",
            system: "Investigate without editing files.",
            allowedTools: ["Glob"],
            deniedBehavior: "reject",
            codemode: { excludeTools: ["Bash"] },
            metadata: { lane: "analysis" },
          },
        ],
      },
      { models: { fast, deep } },
    );

    if ("error" in result) throw new Error(result.error);
    expect(result.defaultProfile).toBe("researcher");
    expect(result.defaults?.model).toBe(fast);
    expect(result.profiles[0]).toMatchObject({
      name: "researcher",
      description: "Read-only research",
      nickname: "research",
      system: "Investigate without editing files.",
      allowedTools: ["Glob"],
      deniedBehavior: "reject",
      codemode: { excludeTools: ["Bash"] },
      metadata: { lane: "analysis" },
    });
    expect(result.profiles[0].model).toBe(deep);

    const registry = createSubagentProfileRegistry({
      defaultProfile: result.defaultProfile,
      defaults: result.defaults,
      profiles: result.profiles,
    });
    const resolved = registry.resolve(undefined);
    if ("error" in resolved) throw new Error(resolved.error);
    expect(resolved.name).toBe("researcher");
    expect(resolved.model).toBe(deep);
    expect(resolved.allowedTools).toEqual(["Read", "Grep", "Glob"]);
    expect(resolved.deniedTools).toEqual(["Write"]);
    expect(resolved.context).toEqual({ mode: "recent", turns: 2 });
  });

  it("supports resolver callbacks for model aliases", () => {
    const resolvedModel = model("callback-model");
    const result = loadSubagentProfilesFromJson(
      JSON.stringify({
        profiles: [{ name: "worker", model: "callback" }],
      }),
      {
        resolveModel: (modelAlias) =>
          modelAlias === "callback" ? resolvedModel : undefined,
      },
    );

    if ("error" in result) throw new Error(result.error);
    expect(result.profiles[0].model).toBe(resolvedModel);
  });

  it("returns model-visible errors for invalid JSON and schema failures", () => {
    expect(loadSubagentProfilesFromJson("{")).toMatchObject({
      error: expect.stringContaining("Invalid subagent profile JSON"),
    });

    expect(
      loadSubagentProfilesFromObject({
        profiles: [{ name: "", context: { recent_turns: -1 } }],
      }),
    ).toMatchObject({
      error: expect.stringContaining("Invalid subagent profile config"),
    });
  });

  it("returns an error when a model alias is unknown", () => {
    expect(
      loadSubagentProfilesFromObject({
        profiles: [{ name: "researcher", model: "missing" }],
      }),
    ).toEqual({
      error: "Unknown subagent model alias: missing",
    });
  });

  it("loads profile JSON through an injected file reader", async () => {
    const result = await loadSubagentProfilesFromFile(
      "/profiles/subagents.json",
      {
        readFile: async () =>
          JSON.stringify({ profiles: [{ name: "reviewer" }] }),
      },
    );

    expect(result).toMatchObject({
      profiles: [{ name: "reviewer" }],
    });
  });

  it("returns file read failures as error objects", async () => {
    const result = await loadSubagentProfilesFromFile("/missing.json", {
      readFile: async () => {
        throw new Error("not found");
      },
    });

    expect(result).toEqual({
      error: "Failed to read subagent profile file /missing.json: not found",
    });
  });
});
