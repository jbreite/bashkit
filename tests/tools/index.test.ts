import { describe, it, expect, beforeEach } from "vitest";
import { createAgentTools, type AgentToolsResult } from "@/tools/index";
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

  describe("default tools", () => {
    it("should create core sandbox tools by default", async () => {
      const { tools } = await createAgentTools(sandbox);

      expect(tools.Bash).toBeDefined();
      expect(tools.Read).toBeDefined();
      expect(tools.Write).toBeDefined();
      expect(tools.Edit).toBeDefined();
      expect(tools.Glob).toBeDefined();
      expect(tools.Grep).toBeDefined();
    });

    it("should not include optional tools by default", async () => {
      const { tools } = await createAgentTools(sandbox);

      expect(tools.WebSearch).toBeUndefined();
      expect(tools.WebFetch).toBeUndefined();
      expect(tools.AskUser).toBeUndefined();
      expect(tools.EnterPlanMode).toBeUndefined();
      expect(tools.ExitPlanMode).toBeUndefined();
      expect(tools.Skill).toBeUndefined();
    });

    it("should not return planModeState by default", async () => {
      const result = await createAgentTools(sandbox);

      expect(result.planModeState).toBeUndefined();
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
        askUser: {
          onQuestion: async (q) => `Answer to: ${q}`,
        },
      });

      expect(tools.AskUser).toBeDefined();
    });

    it("should not include AskUser without config", async () => {
      const { tools } = await createAgentTools(sandbox);

      expect(tools.AskUser).toBeUndefined();
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
        askUser: { onQuestion: async () => "answer" },
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
