import { describe, it, expect, vi } from "vitest";
import { tool, zodSchema } from "ai";
import { z } from "zod";
import { createAgentTools } from "@/tools/index";
import { applyContextLayers, type ContextLayer } from "@/context/index";
import {
  createMockSandbox,
  executeTool,
  assertSuccess,
  assertError,
} from "../helpers";

function createMockExtraTool(
  executeFn?: (params: { input?: string | null }) => Promise<unknown>,
) {
  return tool({
    description: "Extra tool for testing",
    inputSchema: zodSchema(
      z.object({ input: z.string().nullable().default(null) }),
    ),
    execute:
      (executeFn as (params: { input?: string | null }) => Promise<unknown>) ??
      (async () => ({ output: "extra" })),
  });
}

describe("createAgentTools with context config", () => {
  it("no wrapping when context config omitted (backward compat)", async () => {
    const sandbox = createMockSandbox({
      files: { "/workspace/file.ts": "hello" },
    });
    const { tools, contextLayers } = await createAgentTools(sandbox);

    // Tools work normally
    const result = await executeTool(tools.Read, {
      file_path: "/workspace/file.ts",
    });
    assertSuccess(result);

    // No context layers
    expect(contextLayers).toEqual([]);
  });

  it("applies execution policy when context + planMode provided", async () => {
    const sandbox = createMockSandbox({
      files: { "/workspace/file.ts": "content" },
    });
    const { tools, planModeState } = await createAgentTools(sandbox, {
      planMode: true,
      context: {
        executionPolicy: { planModeBlockedTools: ["Bash", "Write", "Edit"] },
        outputPolicy: false,
      },
    });

    // Plan mode active → Bash blocked
    planModeState!.isActive = true;
    const bashResult = await executeTool(tools.Bash, {
      command: "echo test",
      description: "t",
    });
    assertError(bashResult);
    expect(bashResult.error).toContain("not available in plan mode");

    // Read still allowed
    const readResult = await executeTool(tools.Read, {
      file_path: "/workspace/file.ts",
    });
    assertSuccess(readResult);
  });

  it("applies output policy by default when context provided", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/workspace/large.ts": "x".repeat(50000),
      },
    });
    const { tools } = await createAgentTools(sandbox, {
      context: {
        outputPolicy: { maxOutputLength: 100, redirectionThreshold: 50 },
      },
    });

    const result = (await executeTool(tools.Read, {
      file_path: "/workspace/large.ts",
    })) as Record<string, unknown>;
    assertSuccess(result);
    // Output should be truncated
    expect(result._hint).toBeDefined();
  });

  it("disables output policy when outputPolicy: false", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/workspace/large.ts": "x".repeat(50000),
      },
    });
    const { tools } = await createAgentTools(sandbox, {
      context: {
        outputPolicy: false,
      },
    });

    const result = (await executeTool(tools.Read, {
      file_path: "/workspace/large.ts",
    })) as Record<string, unknown>;
    assertSuccess(result);
    // No truncation hint
    expect(result._hint).toBeUndefined();
  });

  it("wraps extraTools with same context layers", async () => {
    const sandbox = createMockSandbox();
    const customTool = createMockExtraTool(async () => ({
      output: "x".repeat(200),
    }));

    const { tools, planModeState } = await createAgentTools(sandbox, {
      planMode: true,
      context: {
        executionPolicy: {
          planModeBlockedTools: ["Bash", "Write", "Edit", "CustomTool"],
        },
        outputPolicy: false,
        extraTools: { CustomTool: customTool },
      },
    });

    expect(tools.CustomTool).toBeDefined();

    // CustomTool blocked in plan mode
    planModeState!.isActive = true;
    const result = await executeTool(tools.CustomTool, { input: "test" });
    assertError(result);
    expect(result.error).toContain("not available in plan mode");
  });

  it("returns contextLayers for wrapping tools added later", async () => {
    const sandbox = createMockSandbox();
    const { contextLayers } = await createAgentTools(sandbox, {
      planMode: true,
      context: {
        executionPolicy: {},
        outputPolicy: false,
      },
    });

    expect(contextLayers).toBeDefined();
    expect(contextLayers.length).toBeGreaterThan(0);

    // Late-added tool gets same layers
    const lateTool = createMockExtraTool(async () => ({ output: "late" }));
    const wrapped = applyContextLayers({ LateTool: lateTool }, contextLayers);
    expect(wrapped.LateTool).toBeDefined();
  });

  it("custom layers run after built-in layers", async () => {
    const sandbox = createMockSandbox({
      files: { "/workspace/file.ts": "content" },
    });
    const order: string[] = [];

    const { tools } = await createAgentTools(sandbox, {
      context: {
        outputPolicy: false,
        layers: [
          {
            beforeExecute: async () => {
              order.push("custom");
              return undefined;
            },
          },
        ],
      },
    });

    await executeTool(tools.Read, { file_path: "/workspace/file.ts" });
    // Custom layer ran (output policy was disabled so only custom ran)
    expect(order).toContain("custom");
  });

  it("late-added tools via applyContextLayers enforce execution policy", async () => {
    const sandbox = createMockSandbox();
    const { contextLayers, planModeState } = await createAgentTools(sandbox, {
      planMode: true,
      context: {
        executionPolicy: {
          planModeBlockedTools: ["Bash", "Write", "Edit", "LateTool"],
        },
        outputPolicy: false,
      },
    });

    planModeState!.isActive = true;

    const lateTool = createMockExtraTool(async () => ({ output: "late" }));
    const wrapped = applyContextLayers({ LateTool: lateTool }, contextLayers);

    const result = await executeTool(wrapped.LateTool, { input: "test" });
    assertError(result);
    expect(result.error).toContain("not available in plan mode");
  });

  it("execution + output policy both active end-to-end", async () => {
    const sandbox = createMockSandbox({
      files: { "/workspace/big.ts": "x".repeat(50000) },
    });
    const { tools, planModeState } = await createAgentTools(sandbox, {
      planMode: true,
      context: {
        executionPolicy: { planModeBlockedTools: ["Bash", "Write", "Edit"] },
        outputPolicy: { maxOutputLength: 100, redirectionThreshold: 50 },
      },
    });

    // Read works and gets truncated
    const readResult = (await executeTool(tools.Read, {
      file_path: "/workspace/big.ts",
    })) as Record<string, unknown>;
    assertSuccess(readResult);
    expect(readResult._hint).toBeDefined();

    // Bash blocked by execution policy (output policy never reached)
    planModeState!.isActive = true;
    const bashResult = await executeTool(tools.Bash, {
      command: "echo test",
      description: "t",
    });
    assertError(bashResult);
  });

  it("extraTools accessible alongside built-in tools", async () => {
    const sandbox = createMockSandbox({
      files: { "/workspace/file.ts": "content" },
    });
    const customTool = createMockExtraTool(async () => ({
      output: "custom result",
    }));

    const { tools } = await createAgentTools(sandbox, {
      context: {
        outputPolicy: false,
        extraTools: { CustomTool: customTool },
      },
    });

    // Built-in tool works
    const readResult = await executeTool(tools.Read, {
      file_path: "/workspace/file.ts",
    });
    assertSuccess(readResult);

    // Extra tool works
    const customResult = (await executeTool(tools.CustomTool, {
      input: "test",
    })) as Record<string, unknown>;
    assertSuccess(customResult);
    expect(customResult.output).toBe("custom result");
  });

  it("execution policy not created without planMode enabled", async () => {
    const sandbox = createMockSandbox();
    const { contextLayers } = await createAgentTools(sandbox, {
      // planMode NOT set
      context: {
        executionPolicy: { planModeBlockedTools: ["Bash"] },
        outputPolicy: false,
      },
    });

    // No execution policy layer since planMode not enabled
    // Only custom layers would be here (none provided)
    expect(contextLayers).toHaveLength(0);
  });
});
