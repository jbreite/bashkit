import { describe, it, expect, vi } from "vitest";
import { tool, zodSchema, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import { createAgentTools } from "@/tools/index";
import {
  createCodemodeTool,
  selectCodemodeTools,
  type CodemodeExecutor,
  type CreateCodeTool,
} from "@/tools/codemode";
import { applyContextLayers } from "@/context/index";
import { createExecutionPolicy } from "@/context/execution-policy";
import { executeTool, assertError, assertSuccess } from "@test/helpers";
import { createMockSandbox } from "@test/helpers";

function createExecutableTool(output: unknown = { output: "ok" }): Tool {
  return tool({
    description: "Executable test tool",
    inputSchema: zodSchema(z.object({})),
    execute: async () => output,
  });
}

function createDeferredTool(): Tool {
  return tool({
    description: "Deferred test tool",
    inputSchema: zodSchema(z.object({})),
  });
}

function createApprovalTool(): Tool {
  return Object.assign(createExecutableTool(), { needsApproval: true });
}

function createExecutor(): CodemodeExecutor {
  return {
    execute: async () => ({ result: null }),
  };
}

function createCapturingCodeTool(captured: ToolSet[]): CreateCodeTool {
  return async ({ tools }) => {
    const availableTools = Array.isArray(tools)
      ? Object.assign({}, ...tools.map((provider) => provider.tools))
      : tools;
    captured.push(availableTools);

    return tool({
      description: "Mock codemode tool",
      inputSchema: zodSchema(
        z.object({
          toolName: z.string(),
          params: z.record(z.string(), z.unknown()),
        }),
      ),
      execute: async ({
        toolName,
        params,
      }: {
        toolName: string;
        params: Record<string, unknown>;
      }) => {
        const selected = availableTools[toolName];
        if (!selected?.execute) return { error: `Missing tool: ${toolName}` };
        return await executeTool(selected, params);
      },
    });
  };
}

describe("selectCodemodeTools", () => {
  it("excludes client-intervention and deferred tools", () => {
    const excluded: Array<[string, string]> = [];
    const tools: ToolSet = {
      Read: createExecutableTool(),
      AskUser: createDeferredTool(),
      EnterPlanMode: createExecutableTool(),
      ExitPlanMode: createExecutableTool(),
      Deferred: createDeferredTool(),
      NeedsApproval: createApprovalTool(),
    };

    const selected = selectCodemodeTools(tools, {
      onToolExcluded: (toolName, reason) => excluded.push([toolName, reason]),
    });

    expect(Object.keys(selected)).toEqual(["Read"]);
    expect(excluded).toEqual(
      expect.arrayContaining([
        ["AskUser", "excluded-by-default"],
        ["EnterPlanMode", "excluded-by-default"],
        ["ExitPlanMode", "excluded-by-default"],
        ["Deferred", "no-execute"],
        ["NeedsApproval", "needs-approval"],
      ]),
    );
  });

  it("supports includeTools and excludeTools without mutating input", () => {
    const tools: ToolSet = {
      Read: createExecutableTool(),
      Grep: createExecutableTool(),
      Bash: createExecutableTool(),
    };

    const selected = selectCodemodeTools(tools, {
      includeTools: ["Read", "Grep"],
      excludeTools: ["Grep"],
    });

    expect(Object.keys(selected)).toEqual(["Read"]);
    expect(Object.keys(tools)).toEqual(["Read", "Grep", "Bash"]);
  });
});

describe("createCodemodeTool", () => {
  it("delegates to injected createCodeTool with filtered tools", async () => {
    const captured: ToolSet[] = [];
    const createCodeTool = vi.fn(createCapturingCodeTool(captured));

    const result = await createCodemodeTool(
      {
        Read: createExecutableTool(),
        AskUser: createDeferredTool(),
      },
      {
        executor: createExecutor(),
        createCodeTool,
      },
    );

    expect(result.name).toBe("codemode");
    expect(result.runtimeTools.Read).toBeDefined();
    expect(result.runtimeTools.AskUser).toBeUndefined();
    expect(result.providers).toEqual([
      { name: "bashkit", tools: result.runtimeTools },
    ]);
    expect(createCodeTool).toHaveBeenCalledWith({
      tools: result.providers,
      executor: expect.objectContaining({ execute: expect.any(Function) }),
    });
  });

  it("supports overriding the default BashKit namespace", async () => {
    const createCodeTool = vi.fn(createCapturingCodeTool([]));

    const result = await createCodemodeTool(
      {
        Read: createExecutableTool(),
      },
      {
        executor: createExecutor(),
        namespace: "workspace",
        createCodeTool,
      },
    );

    expect(result.providers[0].name).toBe("workspace");
    expect(createCodeTool).toHaveBeenCalledWith({
      tools: result.providers,
      executor: expect.objectContaining({ execute: expect.any(Function) }),
    });
  });

  it("supports named providers and filters each provider", async () => {
    const createCodeTool = vi.fn(createCapturingCodeTool([]));

    const result = await createCodemodeTool(
      {
        Read: createExecutableTool(),
      },
      {
        executor: createExecutor(),
        providers: [
          {
            name: "repo",
            tools: {
              Summarize: createExecutableTool(),
              NeedsApproval: createApprovalTool(),
            },
          },
        ],
        createCodeTool,
      },
    );

    expect(result.providers).toHaveLength(2);
    expect(result.providers[0].tools.Read).toBeDefined();
    expect(result.providers[1].name).toBe("repo");
    expect(result.providers[1].tools.Summarize).toBeDefined();
    expect(result.providers[1].tools.NeedsApproval).toBeUndefined();
    expect(createCodeTool).toHaveBeenCalledWith({
      tools: result.providers,
      executor: expect.objectContaining({ execute: expect.any(Function) }),
    });
  });

  it("does not apply default includeTools to named providers", async () => {
    const createCodeTool = vi.fn(createCapturingCodeTool([]));

    const result = await createCodemodeTool(
      {
        Read: createExecutableTool(),
        Bash: createExecutableTool(),
      },
      {
        executor: createExecutor(),
        includeTools: ["Read"],
        providers: [
          {
            name: "github",
            tools: {
              ListIssues: createExecutableTool(),
              FetchPullRequest: createExecutableTool(),
            },
          },
        ],
        createCodeTool,
      },
    );

    expect(Object.keys(result.providers[0].tools)).toEqual(["Read"]);
    expect(Object.keys(result.providers[1].tools)).toEqual([
      "ListIssues",
      "FetchPullRequest",
    ]);
  });

  it("supports provider-specific includeTools", async () => {
    const createCodeTool = vi.fn(createCapturingCodeTool([]));

    const result = await createCodemodeTool(
      {
        Read: createExecutableTool(),
      },
      {
        executor: createExecutor(),
        providers: [
          {
            name: "github",
            tools: {
              ListIssues: createExecutableTool(),
              FetchPullRequest: createExecutableTool(),
            },
            includeTools: ["ListIssues"],
          },
        ],
        createCodeTool,
      },
    );

    expect(Object.keys(result.providers[1].tools)).toEqual(["ListIssues"]);
  });

  it("passes a custom description through to createCodeTool", async () => {
    const createCodeTool = vi.fn(createCapturingCodeTool([]));

    await createCodemodeTool(
      {
        Read: createExecutableTool(),
      },
      {
        executor: createExecutor(),
        description: "Run code with these tools:\n{{types}}",
        createCodeTool,
      },
    );

    expect(createCodeTool).toHaveBeenCalledWith({
      tools: [
        {
          name: "bashkit",
          tools: expect.objectContaining({ Read: expect.any(Object) }),
        },
      ],
      executor: expect.objectContaining({ execute: expect.any(Function) }),
      description: "Run code with these tools:\n{{types}}",
    });
  });

  it("returns an error object when codemode execution throws", async () => {
    const createCodeTool: CreateCodeTool = async () =>
      tool({
        description: "Throwing codemode tool",
        inputSchema: zodSchema(z.object({})),
        execute: async (): Promise<unknown> => {
          throw new Error("worker crashed");
        },
      });

    const result = await createCodemodeTool(
      {
        Read: createExecutableTool(),
      },
      {
        executor: createExecutor(),
        createCodeTool,
      },
    );

    const output = await executeTool(result.tool, {});

    assertError(output);
    expect(output.error).toContain("Codemode execution failed");
    expect(output.error).toContain("worker crashed");
  });
});

describe("createAgentTools codemode config", () => {
  it("adds a codemode tool using selected wrapped tools", async () => {
    const sandbox = createMockSandbox();
    const captured: ToolSet[] = [];

    const { tools } = await createAgentTools(sandbox, {
      askUser: true,
      planMode: true,
      codemode: {
        executor: createExecutor(),
        createCodeTool: createCapturingCodeTool(captured),
      },
    });

    expect(tools.codemode).toBeDefined();
    expect(captured).toHaveLength(1);
    expect(captured[0].Bash).toBeDefined();
    expect(captured[0].AskUser).toBeUndefined();
    expect(captured[0].EnterPlanMode).toBeUndefined();
    expect(captured[0].ExitPlanMode).toBeUndefined();
  });

  it("adds codemode-only extra tools to the runtime tool set", async () => {
    const sandbox = createMockSandbox();
    const captured: ToolSet[] = [];

    const { tools } = await createAgentTools(sandbox, {
      codemode: {
        executor: createExecutor(),
        tools: {
          CustomTool: createExecutableTool({ output: "custom" }),
        },
        createCodeTool: createCapturingCodeTool(captured),
      },
    });

    expect(tools.CustomTool).toBeUndefined();
    expect(captured[0].CustomTool).toBeDefined();
  });

  it("wraps named provider tools with context layers", async () => {
    const sandbox = createMockSandbox();
    const createCodeTool: CreateCodeTool = async ({ tools }) => {
      const providers = Array.isArray(tools) ? tools : [];
      const repoProvider = providers.find(
        (provider) => provider.name === "repo",
      );
      const repoTools = repoProvider?.tools ?? {};

      return tool({
        description: "Mock provider codemode tool",
        inputSchema: zodSchema(z.object({})),
        execute: async () => {
          const result = await executeTool(repoTools.BashAlias, {});
          return result;
        },
      });
    };

    const { tools, planModeState } = await createAgentTools(sandbox, {
      planMode: true,
      context: {
        executionPolicy: {
          planModeBlockedTools: ["BashAlias"],
        },
        outputPolicy: false,
      },
      codemode: {
        executor: createExecutor(),
        providers: [
          {
            name: "repo",
            tools: {
              BashAlias: createExecutableTool({ output: "ran" }),
            },
          },
        ],
        createCodeTool,
      },
    });

    if (!planModeState) throw new Error("expected planModeState");
    planModeState.isActive = true;

    const result = await executeTool(tools.codemode, {});

    assertError(result);
    expect(result.error).toContain("not available in plan mode");
  });

  it("preserves execution policy inside codemode", async () => {
    const sandbox = createMockSandbox();
    const { tools, planModeState } = await createAgentTools(sandbox, {
      planMode: true,
      context: {
        executionPolicy: {},
        outputPolicy: false,
      },
      codemode: {
        executor: createExecutor(),
        createCodeTool: createCapturingCodeTool([]),
      },
    });

    if (!planModeState) throw new Error("expected planModeState");
    planModeState.isActive = true;

    const result = await executeTool(tools.codemode, {
      toolName: "Bash",
      params: { command: "echo hi", description: "test" },
    });

    assertError(result);
    expect(result.error).toContain("not available in plan mode");
  });

  it("wraps the top-level codemode tool with output policy", async () => {
    const sandbox = createMockSandbox();
    const createCodeTool: CreateCodeTool = async () =>
      createExecutableTool({ output: "x".repeat(200) });

    const { tools } = await createAgentTools(sandbox, {
      context: {
        outputPolicy: { maxOutputLength: 100, redirectionThreshold: 50 },
      },
      codemode: {
        executor: createExecutor(),
        createCodeTool,
      },
    });

    const result = await executeTool(tools.codemode, {});

    assertSuccess<Record<string, unknown>>(result);
    expect(result._hint).toBeDefined();
  });

  it("rejects codemode tool name conflicts", async () => {
    const sandbox = createMockSandbox();

    await expect(
      createAgentTools(sandbox, {
        codemode: {
          executor: createExecutor(),
          toolName: "Bash",
          createCodeTool: createCapturingCodeTool([]),
        },
      }),
    ).rejects.toThrow('Codemode tool name "Bash" conflicts');
  });
});

describe("codemode with standalone context layers", () => {
  it("keeps selected tools policy-wrapped when passed manually", async () => {
    const state = { isActive: true };
    const wrapped = applyContextLayers(
      { Bash: createExecutableTool({ output: "ran" }) },
      [createExecutionPolicy(state)],
    );
    const captured: ToolSet[] = [];

    await createCodemodeTool(wrapped, {
      executor: createExecutor(),
      createCodeTool: createCapturingCodeTool(captured),
    });

    const result = await executeTool(captured[0].Bash, {});
    assertError(result);
    expect(result.error).toContain("not available in plan mode");
  });
});
