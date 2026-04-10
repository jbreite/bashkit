import { describe, it, expect } from "vitest";
import type { PlanModeState } from "@/tools/enter-plan-mode";
import { createExecutionPolicy } from "@/context/execution-policy";
import { applyContextLayers, type ContextLayer } from "@/context/index";
import { createAgentTools } from "@/tools/index";
import {
  createMockSandbox,
  executeTool,
  assertSuccess,
  assertError,
} from "../helpers";

describe("context layer under parallel execution", () => {
  it("beforeExecute runs independently for each parallel call", async () => {
    const callLog: string[] = [];
    const layer: ContextLayer = {
      beforeExecute: async (toolName) => {
        callLog.push(`before:${toolName}`);
        await new Promise((r) => setTimeout(r, 10));
        callLog.push(`before-done:${toolName}`);
        return undefined;
      },
    };

    const sandbox = createMockSandbox({
      files: {
        "/workspace/file.ts": "content",
        "/workspace/file2.ts": "content2",
      },
    });
    const { tools } = await createAgentTools(sandbox, {
      context: {
        outputPolicy: false,
        layers: [layer],
      },
    });

    // Simulate parallel dispatch
    await Promise.all([
      executeTool(tools.Read, { file_path: "/workspace/file.ts" }),
      executeTool(tools.Read, { file_path: "/workspace/file2.ts" }),
    ]);

    // Both calls should have their before entries
    const beforeStarts = callLog.filter((l) => l.startsWith("before:"));
    expect(beforeStarts).toHaveLength(2);
  });

  it("rejection in one parallel call doesn't block others", async () => {
    const sandbox = createMockSandbox({
      files: { "/workspace/file.ts": "content" },
    });
    const { tools, planModeState } = await createAgentTools(sandbox, {
      planMode: true,
      context: {
        executionPolicy: { planModeBlockedTools: ["Bash"] },
        outputPolicy: false,
      },
    });

    planModeState!.isActive = true;

    const [bashResult, readResult] = await Promise.all([
      executeTool(tools.Bash, { command: "echo test", description: "t" }),
      executeTool(tools.Read, { file_path: "/workspace/file.ts" }),
    ]);

    assertError(bashResult);
    assertSuccess(readResult);
  });

  it("plan mode state change mid-parallel does not corrupt results", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/workspace/a.ts": "aaa",
        "/workspace/b.ts": "bbb",
      },
    });
    const { tools, planModeState } = await createAgentTools(sandbox, {
      planMode: true,
      context: {
        executionPolicy: { planModeBlockedTools: ["Bash"] },
        outputPolicy: false,
      },
    });

    planModeState!.isActive = false;

    // Fire off parallel reads, toggle plan mode during execution
    const results = await Promise.all([
      executeTool(tools.Read, { file_path: "/workspace/a.ts" }),
      (async () => {
        // Small delay then toggle — reads should still complete
        await new Promise((r) => setTimeout(r, 1));
        planModeState!.isActive = true;
        return executeTool(tools.Read, { file_path: "/workspace/b.ts" });
      })(),
    ]);

    // Both reads should succeed (Read is not blocked)
    assertSuccess(results[0]);
    assertSuccess(results[1]);
  });

  it("stashOutput under parallel calls writes separate files", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/workspace/a.ts": "a".repeat(100),
        "/workspace/b.ts": "b".repeat(100),
      },
    });
    const { tools } = await createAgentTools(sandbox, {
      context: {
        outputPolicy: {
          maxOutputLength: 50,
          redirectionThreshold: 10,
          stashOutput: {
            sandbox,
            tools: ["Read"],
          },
        },
      },
    });

    await Promise.all([
      executeTool(tools.Read, { file_path: "/workspace/a.ts" }),
      executeTool(tools.Read, { file_path: "/workspace/b.ts" }),
    ]);

    // Should have two separate stash files
    const files = sandbox.getFiles();
    const stashPaths = Object.keys(files).filter((p) =>
      p.startsWith("/tmp/.bashkit/tool-output/Read-"),
    );
    expect(stashPaths.length).toBe(2);
  });

  it("afterExecute transforms are isolated between parallel calls", async () => {
    let callCount = 0;
    const layer: ContextLayer = {
      afterExecute: async (_toolName, _params, result) => {
        callCount++;
        const myCount = callCount;
        // Small delay to encourage interleaving
        await new Promise((r) => setTimeout(r, 5));
        return { ...result, _callNumber: myCount };
      },
    };

    const sandbox = createMockSandbox({
      files: {
        "/workspace/a.ts": "aaa",
        "/workspace/b.ts": "bbb",
      },
    });
    const { tools } = await createAgentTools(sandbox, {
      context: {
        outputPolicy: false,
        layers: [layer],
      },
    });

    const results = await Promise.all([
      executeTool(tools.Read, { file_path: "/workspace/a.ts" }),
      executeTool(tools.Read, { file_path: "/workspace/b.ts" }),
    ]);

    const r0 = results[0] as Record<string, unknown>;
    const r1 = results[1] as Record<string, unknown>;

    // Each got its own transform, no shared state corruption
    expect(r0._callNumber).not.toBe(r1._callNumber);
    expect([r0._callNumber, r1._callNumber].sort()).toEqual([1, 2]);
  });
});
