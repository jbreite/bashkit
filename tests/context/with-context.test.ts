import { describe, it, expect, vi } from "vitest";
import { tool, zodSchema } from "ai";
import { z } from "zod";
import {
  withContext,
  applyContextLayers,
  type ContextLayer,
} from "@/context/index";
import {
  createMockSandbox,
  executeTool,
  assertSuccess,
  assertError,
} from "../helpers";
import { createReadTool } from "@/tools/read";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockParams = { input?: string | null };

function createMockTool(executeFn?: (params: MockParams) => Promise<unknown>) {
  return tool({
    description: "Mock tool for testing",
    inputSchema: zodSchema(
      z.object({
        input: z.string().nullable().default(null),
      }),
    ),
    execute:
      (executeFn as (params: MockParams) => Promise<unknown>) ??
      (async () => ({ output: "default" })),
  });
}

// ---------------------------------------------------------------------------
// withContext()
// ---------------------------------------------------------------------------

describe("withContext", () => {
  it("passes through when no layers reject or transform", async () => {
    const mockTool = createMockTool(async () => ({ output: "hello" }));
    const wrapped = withContext(mockTool, "Mock", []);
    const result = await executeTool(wrapped, { input: "test" });
    assertSuccess(result);
    expect((result as Record<string, unknown>).output).toBe("hello");
  });

  it("returns error from beforeExecute without calling execute", async () => {
    const executeSpy = vi.fn(async () => ({ output: "should not run" }));
    const mockTool = createMockTool(executeSpy);
    const layer: ContextLayer = {
      beforeExecute: async () => ({ error: "blocked" }),
    };
    const wrapped = withContext(mockTool, "Mock", [layer]);
    const result = await executeTool(wrapped, { input: "test" });
    assertError(result);
    expect(result.error).toBe("blocked");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("supports sync beforeExecute", async () => {
    const mockTool = createMockTool();
    const layer: ContextLayer = {
      beforeExecute: () => ({ error: "sync block" }),
    };
    const wrapped = withContext(mockTool, "Mock", [layer]);
    const result = await executeTool(wrapped, { input: "test" });
    assertError(result);
    expect(result.error).toBe("sync block");
  });

  it("transforms result through afterExecute", async () => {
    const mockTool = createMockTool(async () => ({ output: "original" }));
    const layer: ContextLayer = {
      afterExecute: async (_toolName, _params, result) => ({
        ...result,
        _transformed: true,
      }),
    };
    const wrapped = withContext(mockTool, "Mock", [layer]);
    const result = await executeTool(wrapped, { input: "test" });
    assertSuccess(result);
    expect((result as Record<string, unknown>)._transformed).toBe(true);
    expect((result as Record<string, unknown>).output).toBe("original");
  });

  it("supports sync afterExecute", async () => {
    const mockTool = createMockTool(async () => ({ output: "original" }));
    const layer: ContextLayer = {
      afterExecute: (_toolName, _params, result) => ({
        ...result,
        _sync: true,
      }),
    };
    const wrapped = withContext(mockTool, "Mock", [layer]);
    const result = await executeTool(wrapped, { input: "test" });
    assertSuccess(result);
    expect((result as Record<string, unknown>)._sync).toBe(true);
  });

  it("stops at first beforeExecute rejection", async () => {
    const mockTool = createMockTool();
    const layer2Spy = vi.fn();
    const layer1: ContextLayer = {
      beforeExecute: async () => ({ error: "layer 1 blocked" }),
    };
    const layer2: ContextLayer = {
      beforeExecute: async () => {
        layer2Spy();
        return { error: "layer 2 blocked" };
      },
    };
    const wrapped = withContext(mockTool, "Mock", [layer1, layer2]);
    const result = await executeTool(wrapped, { input: "test" });
    assertError(result);
    expect(result.error).toBe("layer 1 blocked");
    expect(layer2Spy).not.toHaveBeenCalled();
  });

  it("allows execution when beforeExecute returns undefined", async () => {
    const mockTool = createMockTool(async () => ({ output: "allowed" }));
    const layer: ContextLayer = {
      beforeExecute: async () => undefined,
    };
    const wrapped = withContext(mockTool, "Mock", [layer]);
    const result = await executeTool(wrapped, { input: "test" });
    assertSuccess(result);
    expect((result as Record<string, unknown>).output).toBe("allowed");
  });

  it("chains afterExecute transforms in order", async () => {
    const mockTool = createMockTool(async () => ({ value: 0 }));
    const layer1: ContextLayer = {
      afterExecute: async (_tn, _p, result) => ({
        ...result,
        step1: true,
      }),
    };
    const layer2: ContextLayer = {
      afterExecute: async (_tn, _p, result) => ({
        ...result,
        step2: true,
        sawStep1: result.step1,
      }),
    };
    const wrapped = withContext(mockTool, "Mock", [layer1, layer2]);
    const result = (await executeTool(wrapped, {
      input: "test",
    })) as Record<string, unknown>;
    assertSuccess(result);
    expect(result.step1).toBe(true);
    expect(result.step2).toBe(true);
    expect(result.sawStep1).toBe(true);
  });

  it("returns tool unchanged when it has no execute function", () => {
    const noExecTool = {
      description: "Tool without execute",
      parameters: zodSchema(z.object({})),
    } as unknown as ReturnType<typeof tool>;

    const layer: ContextLayer = {
      beforeExecute: async () => ({ error: "should not matter" }),
    };
    const wrapped = withContext(noExecTool, "NoExec", [layer]);
    expect(wrapped).toBe(noExecTool); // same reference
  });

  it("passes correct toolName to layers", async () => {
    const mockTool = createMockTool(async () => ({ output: "ok" }));
    let receivedName: string | undefined;
    const layer: ContextLayer = {
      beforeExecute: async (toolName) => {
        receivedName = toolName;
        return undefined;
      },
    };
    const wrapped = withContext(mockTool, "MyToolName", [layer]);
    await executeTool(wrapped, { input: "test" });
    expect(receivedName).toBe("MyToolName");
  });

  it("beforeExecute error in layer propagates as rejection", async () => {
    const mockTool = createMockTool(async () => ({ output: "ok" }));
    const layer: ContextLayer = {
      beforeExecute: async () => {
        throw new Error("layer exploded");
      },
    };
    const wrapped = withContext(mockTool, "Mock", [layer]);
    await expect(executeTool(wrapped, { input: "test" })).rejects.toThrow(
      "layer exploded",
    );
  });

  it("afterExecute error in layer propagates", async () => {
    const mockTool = createMockTool(async () => ({ output: "ok" }));
    const layer: ContextLayer = {
      afterExecute: async () => {
        throw new Error("transform exploded");
      },
    };
    const wrapped = withContext(mockTool, "Mock", [layer]);
    await expect(executeTool(wrapped, { input: "test" })).rejects.toThrow(
      "transform exploded",
    );
  });

  it("beforeExecute allows and afterExecute transforms on same layer", async () => {
    const mockTool = createMockTool(async () => ({ output: "original" }));
    const layer: ContextLayer = {
      beforeExecute: async () => undefined, // allow
      afterExecute: async (_tn, _p, result) => ({
        ...result,
        _combined: true,
      }),
    };
    const wrapped = withContext(mockTool, "Mock", [layer]);
    const result = (await executeTool(wrapped, {
      input: "test",
    })) as Record<string, unknown>;
    assertSuccess(result);
    expect(result.output).toBe("original");
    expect(result._combined).toBe(true);
  });

  it("afterExecute does not run when beforeExecute rejects", async () => {
    const afterSpy = vi.fn();
    const mockTool = createMockTool(async () => ({ output: "ok" }));
    const layer: ContextLayer = {
      beforeExecute: async () => ({ error: "blocked" }),
      afterExecute: async (_tn, _p, result) => {
        afterSpy();
        return result;
      },
    };
    const wrapped = withContext(mockTool, "Mock", [layer]);
    const result = await executeTool(wrapped, { input: "test" });
    assertError(result);
    expect(afterSpy).not.toHaveBeenCalled();
  });

  it("passes params to beforeExecute and afterExecute", async () => {
    const mockTool = createMockTool(async () => ({ output: "ok" }));
    let beforeParams: Record<string, unknown> | undefined;
    let afterParams: Record<string, unknown> | undefined;
    const layer: ContextLayer = {
      beforeExecute: async (_tn, params) => {
        beforeParams = params;
        return undefined;
      },
      afterExecute: async (_tn, params, result) => {
        afterParams = params;
        return result;
      },
    };
    const wrapped = withContext(mockTool, "Mock", [layer]);
    await executeTool(wrapped, { input: "hello" });
    expect(beforeParams?.input).toBe("hello");
    expect(afterParams?.input).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// applyContextLayers()
// ---------------------------------------------------------------------------

describe("applyContextLayers", () => {
  it("wraps all tools in the ToolSet", async () => {
    const sandbox = createMockSandbox({
      files: { "/workspace/file.ts": "content" },
    });

    const tools = {
      Mock1: createMockTool(async () => ({ output: "one" })),
      Mock2: createMockTool(async () => ({ output: "two" })),
    };

    const blockAll: ContextLayer = {
      beforeExecute: async () => ({ error: "blocked" }),
    };
    const wrapped = applyContextLayers(tools, [blockAll]);

    for (const [_name, wrappedTool] of Object.entries(wrapped)) {
      const result = await executeTool(wrappedTool, { input: "test" });
      assertError(result);
      expect(result.error).toBe("blocked");
    }
  });

  it("returns tools unchanged when layers array is empty", () => {
    const tools = {
      Mock: createMockTool(),
    };
    const result = applyContextLayers(tools, []);
    expect(result).toBe(tools); // same reference
  });

  it("preserves tool keys in the returned ToolSet", async () => {
    const tools = {
      Alpha: createMockTool(async () => ({ output: "a" })),
      Beta: createMockTool(async () => ({ output: "b" })),
    };

    const layer: ContextLayer = {
      afterExecute: async (_tn, _p, result) => ({
        ...result,
        _wrapped: true,
      }),
    };

    const wrapped = applyContextLayers(tools, [layer]);
    expect(Object.keys(wrapped)).toEqual(["Alpha", "Beta"]);

    const alphaResult = (await executeTool(wrapped.Alpha, {
      input: "test",
    })) as Record<string, unknown>;
    assertSuccess(alphaResult);
    expect(alphaResult._wrapped).toBe(true);
    expect(alphaResult.output).toBe("a");
  });

  it("passes correct tool name per tool to layers", async () => {
    const tools = {
      Foo: createMockTool(async () => ({ output: "foo" })),
      Bar: createMockTool(async () => ({ output: "bar" })),
    };

    const names: string[] = [];
    const layer: ContextLayer = {
      beforeExecute: async (toolName) => {
        names.push(toolName);
        return undefined;
      },
    };

    const wrapped = applyContextLayers(tools, [layer]);
    await executeTool(wrapped.Foo, { input: "test" });
    await executeTool(wrapped.Bar, { input: "test" });
    expect(names).toEqual(["Foo", "Bar"]);
  });
});
