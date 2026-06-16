import { describe, it, expect, beforeEach } from "vitest";
import {
  createAgentTools,
  type AgentToolsResult,
  type CodemodeExecutor,
} from "@/tools/index";
import * as bashkit from "@/index";
import { createStaticSubagentRunner } from "@/subagents";
import type { WebFetchConfig } from "@/types";
import type { CachedTool } from "@/cache/cached";
import {
  createMockSandbox,
  executeTool,
  type MockSandbox,
} from "@test/helpers";

describe("createAgentTools", () => {
  let sandbox: MockSandbox;

  beforeEach(() => {
    sandbox = createMockSandbox({
      rgPath: "/usr/bin/rg",
    });
  });

  function createExecutor(): CodemodeExecutor {
    return {
      execute: async () => ({ result: null }),
    };
  }

  describe("default tools", () => {
    it("should create core sandbox tools by default", async () => {
      const { tools } = await createAgentTools(sandbox);

      expect(tools.Bash).toBeDefined();
      expect(tools.Read).toBeDefined();
      expect(tools.Write).toBeDefined();
      expect(tools.Edit).toBeDefined();
      expect(tools.Glob).toBeDefined();
      expect(tools.Grep).toBeDefined();
      expect(tools.UpdatePlan).toBeDefined();
    });

    it("should not include optional tools by default", async () => {
      const { tools } = await createAgentTools(sandbox);

      expect(tools.WebSearch).toBeUndefined();
      expect(tools.WebFetch).toBeUndefined();
      expect(tools.AskUser).toBeUndefined();
      expect(tools.EnterPlanMode).toBeUndefined();
      expect(tools.ExitPlanMode).toBeUndefined();
      expect(tools.Skill).toBeUndefined();
      expect(tools.Patch).toBeUndefined();
      expect(tools.codemode).toBeUndefined();
    });

    it("does not export removed legacy Task or TodoWrite factories", () => {
      expect("createTaskTool" in bashkit).toBe(false);
      expect("createTodoWriteTool" in bashkit).toBe(false);
    });

    it("should not return planModeState by default", async () => {
      const result = await createAgentTools(sandbox);

      expect(result.planModeState).toBeUndefined();
      expect(result.planState).toBeDefined();
    });
  });

  describe("tool configuration", () => {
    it("should pass config to Bash tool", async () => {
      const { tools } = await createAgentTools(sandbox, {
        tools: {
          Bash: { timeout: 5000 },
        },
      });

      // Execute tool to verify config is applied
      await executeTool(tools.Bash, { command: "test", description: "test" });

      const history = sandbox.getExecHistory();
      expect(history[0].options?.timeout).toBe(5000);
    });

    it("should pass blockedCommands to Bash tool", async () => {
      const { tools } = await createAgentTools(sandbox, {
        tools: {
          Bash: { blockedCommands: ["rm -rf"] },
        },
      });

      const result = await executeTool(tools.Bash, {
        command: "rm -rf /",
        description: "dangerous",
      });

      expect(result).toHaveProperty("error");
    });
  });

  describe("AskUser tool", () => {
    it("should include AskUser when configured", async () => {
      const { tools } = await createAgentTools(sandbox, {
        askUser: true,
      });

      expect(tools.AskUser).toBeDefined();
    });

    it("should not include AskUser without config", async () => {
      const { tools } = await createAgentTools(sandbox);

      expect(tools.AskUser).toBeUndefined();
    });
  });

  describe("Patch tool", () => {
    it("should include Patch when enabled with patch: true", async () => {
      const { tools } = await createAgentTools(sandbox, {
        patch: true,
      });

      expect(tools.Patch).toBeDefined();
    });

    it("should include Patch when given a ToolConfig", async () => {
      const { tools } = await createAgentTools(sandbox, {
        patch: { allowedPaths: ["/tmp"] },
      });

      expect(tools.Patch).toBeDefined();
    });

    it("should not include Patch without config", async () => {
      const { tools } = await createAgentTools(sandbox);

      expect(tools.Patch).toBeUndefined();
    });
  });

  describe("plan mode tools", () => {
    it("should include plan mode tools when enabled", async () => {
      const { tools, planModeState } = await createAgentTools(sandbox, {
        planMode: true,
      });

      expect(tools.EnterPlanMode).toBeDefined();
      expect(tools.ExitPlanMode).toBeDefined();
      expect(planModeState).toBeDefined();
      expect(planModeState?.isActive).toBe(false);
    });

    it("should not include plan mode tools when disabled", async () => {
      const { tools, planModeState } = await createAgentTools(sandbox, {
        planMode: false,
      });

      expect(tools.EnterPlanMode).toBeUndefined();
      expect(tools.ExitPlanMode).toBeUndefined();
      expect(planModeState).toBeUndefined();
    });
  });

  describe("skill tool", () => {
    it("should include Skill tool when configured", async () => {
      const { tools } = await createAgentTools(sandbox, {
        skill: {
          skills: {
            test: {
              name: "test",
              description: "A test skill",
              path: "/skills/test/SKILL.md",
            },
          },
        },
      });

      expect(tools.Skill).toBeDefined();
    });

    it("should not include Skill tool without config", async () => {
      const { tools } = await createAgentTools(sandbox);

      expect(tools.Skill).toBeUndefined();
    });
  });

  describe("codemode tool", () => {
    it("uses Codemode as the parent coding surface when configured", async () => {
      const captured = { innerTools: [] as string[] };
      const { tools } = await createAgentTools(sandbox, {
        askUser: true,
        codemode: {
          executor: createExecutor(),
          createCodeTool: async ({ tools: innerTools }) => {
            if (Array.isArray(innerTools)) {
              captured.innerTools = Object.keys(innerTools[0]?.tools ?? {});
              const readTool = innerTools[0]?.tools.Read;
              if (!readTool) throw new Error("expected Read tool");
              return readTool;
            }
            captured.innerTools = Object.keys(innerTools);
            return innerTools.Read;
          },
        },
      });

      expect(tools.codemode).toBeDefined();
      expect(tools.UpdatePlan).toBeDefined();
      expect(tools.AskUser).toBeDefined();
      expect(tools.Read).toBeUndefined();
      expect(tools.Bash).toBeUndefined();
      expect(captured.innerTools).toContain("Read");
      expect(captured.innerTools).toContain("Bash");
    });

    it("should not include codemode without config", async () => {
      const { tools } = await createAgentTools(sandbox);

      expect(tools.codemode).toBeUndefined();
    });

    it("can expose direct tools in explicit compatibility mode", async () => {
      const { tools } = await createAgentTools(sandbox, {
        directTools: "legacy",
        codemode: {
          executor: createExecutor(),
          createCodeTool: async ({ tools: innerTools }) => {
            if (Array.isArray(innerTools)) return innerTools[0].tools.Read;
            return innerTools.Read;
          },
        },
      });

      expect(tools.codemode).toBeDefined();
      expect(tools.Read).toBeDefined();
      expect(tools.Bash).toBeDefined();
    });
  });

  describe("subagent controls", () => {
    it("adds controller-backed subagent tools and state when configured", async () => {
      const { tools, subagentController, getSubagentControlPanelState } =
        await createAgentTools(sandbox, {
          subagents: {
            runner: createStaticSubagentRunner({
              status: "completed",
              result: "done",
            }),
            profiles: [
              {
                name: "worker",
                model: { modelId: "worker-model" } as WebFetchConfig["model"],
              },
            ],
          },
        });

      expect(tools.SpawnAgent).toBeDefined();
      expect(tools.ListAgents).toBeDefined();
      expect(tools.WaitAgent).toBeDefined();
      expect(tools.SendMessage).toBeDefined();
      expect(tools.FollowupTask).toBeDefined();
      expect(tools.InterruptAgent).toBeDefined();
      expect(subagentController).toBeDefined();
      expect(getSubagentControlPanelState).toBeDefined();

      const spawned = await subagentController?.spawn({ task: "Do work" });
      if (!spawned || "error" in spawned) throw new Error("expected spawn");
      await subagentController?.wait({
        agent: spawned.agent_id,
        timeoutMs: 500,
      });

      const state = await getSubagentControlPanelState?.();
      expect(state?.terminal_agents[0]).toMatchObject({
        model: { id: "worker-model" },
        status: "completed",
      });
    });
  });

  describe("web tools", () => {
    it("should include WebSearch when configured", async () => {
      const { tools } = await createAgentTools(sandbox, {
        webSearch: {
          apiKey: "test-key",
        },
      });

      expect(tools.WebSearch).toBeDefined();
    });

    it("should include WebFetch when configured", async () => {
      const mockModel = { modelId: "test" } as WebFetchConfig["model"];
      const { tools } = await createAgentTools(sandbox, {
        webFetch: {
          apiKey: "test-key",
          model: mockModel,
        },
      });

      expect(tools.WebFetch).toBeDefined();
    });

    it("should not include web tools without config", async () => {
      const { tools } = await createAgentTools(sandbox);

      expect(tools.WebSearch).toBeUndefined();
      expect(tools.WebFetch).toBeUndefined();
    });
  });

  describe("caching", () => {
    it("should apply caching when cache: true", async () => {
      const { tools } = await createAgentTools(sandbox, {
        cache: true,
      });

      // Cached tools should have getStats method
      expect((tools.Read as CachedTool).getStats).toBeDefined();
      expect((tools.Glob as CachedTool).getStats).toBeDefined();
      expect((tools.Grep as CachedTool).getStats).toBeDefined();
    });

    it("should not cache tools that have side effects", async () => {
      const { tools } = await createAgentTools(sandbox, {
        cache: true,
      });

      // Write and Edit have side effects, shouldn't be cached by default
      expect((tools.Write as CachedTool).getStats).toBeUndefined();
      expect((tools.Edit as CachedTool).getStats).toBeUndefined();
      expect((tools.Bash as CachedTool).getStats).toBeUndefined();
    });

    it("should respect per-tool cache settings", async () => {
      const { tools } = await createAgentTools(sandbox, {
        cache: {
          Read: true,
          Glob: false,
        },
      });

      expect((tools.Read as CachedTool).getStats).toBeDefined();
      expect((tools.Glob as CachedTool).getStats).toBeUndefined();
    });

    it("should not cache when cache: false or undefined", async () => {
      const { tools } = await createAgentTools(sandbox);

      expect((tools.Read as CachedTool).getStats).toBeUndefined();
    });
  });

  describe("return type", () => {
    it("should return AgentToolsResult shape", async () => {
      const result: AgentToolsResult = await createAgentTools(sandbox);

      expect(result).toHaveProperty("tools");
      expect(typeof result.tools).toBe("object");
    });

    it("should return tools as ToolSet", async () => {
      const { tools } = await createAgentTools(sandbox);

      // Each tool should have execute function
      for (const tool of Object.values(tools)) {
        expect(tool).toHaveProperty("execute");
        expect(typeof tool.execute).toBe("function");
      }
    });
  });

  describe("multiple configurations", () => {
    it("should support combining multiple optional tools", async () => {
      const mockModel = { modelId: "test" } as WebFetchConfig["model"];
      const { tools, planModeState } = await createAgentTools(sandbox, {
        planMode: true,
        askUser: true,
        webSearch: { apiKey: "key" },
        webFetch: { apiKey: "key", model: mockModel },
        skill: {
          skills: {
            test: {
              name: "test",
              description: "A test skill",
              path: "/skills/test/SKILL.md",
            },
          },
        },
        cache: true,
      });

      // All optional tools should be present
      expect(tools.EnterPlanMode).toBeDefined();
      expect(tools.ExitPlanMode).toBeDefined();
      expect(tools.AskUser).toBeDefined();
      expect(tools.WebSearch).toBeDefined();
      expect(tools.WebFetch).toBeDefined();
      expect(tools.Skill).toBeDefined();
      expect(planModeState).toBeDefined();

      // Core tools still present
      expect(tools.Bash).toBeDefined();
      expect(tools.Read).toBeDefined();
    });
  });
});
