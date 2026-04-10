import { describe, it, expect, vi } from "vitest";
import type { PlanModeState } from "@/tools/enter-plan-mode";
import { createExecutionPolicy } from "@/context/execution-policy";

/** Resolve beforeExecute result (handles sync/async union) */
async function gate(
  layer: ReturnType<typeof createExecutionPolicy>,
  toolName: string,
  params: Record<string, unknown> = {},
): Promise<{ error: string } | undefined> {
  return await layer.beforeExecute!(toolName, params);
}

describe("createExecutionPolicy", () => {
  it("blocks Bash/Write/Edit when plan mode is active", async () => {
    const state: PlanModeState = { isActive: true };
    const layer = createExecutionPolicy(state);

    for (const toolName of ["Bash", "Write", "Edit"]) {
      const result = await gate(layer, toolName);
      expect(result).toBeDefined();
      expect(result!.error).toContain("not available in plan mode");
      expect(result!.error).toContain(toolName);
    }
  });

  it("allows Read/Grep/Glob when plan mode is active", async () => {
    const state: PlanModeState = { isActive: true };
    const layer = createExecutionPolicy(state);

    for (const toolName of ["Read", "Grep", "Glob"]) {
      const result = await gate(layer, toolName);
      expect(result).toBeUndefined();
    }
  });

  it("allows everything when plan mode is inactive", async () => {
    const state: PlanModeState = { isActive: false };
    const layer = createExecutionPolicy(state);

    for (const toolName of ["Bash", "Write", "Edit", "Read", "Grep", "Glob"]) {
      expect(await gate(layer, toolName)).toBeUndefined();
    }
  });

  it("reacts to plan mode state changes between calls", async () => {
    const state: PlanModeState = { isActive: false };
    const layer = createExecutionPolicy(state);

    expect(await gate(layer, "Bash")).toBeUndefined();

    state.isActive = true;
    expect(await gate(layer, "Bash")).toBeDefined();

    state.isActive = false;
    expect(await gate(layer, "Bash")).toBeUndefined();
  });

  it("supports custom blocked tool list", async () => {
    const state: PlanModeState = { isActive: true };
    const layer = createExecutionPolicy(state, {
      planModeBlockedTools: ["Bash", "Research"],
    });

    // Bash still blocked
    expect(await gate(layer, "Bash")).toBeDefined();
    // Research now blocked
    expect(await gate(layer, "Research")).toBeDefined();
    // Write NOT blocked (not in custom list)
    expect(await gate(layer, "Write")).toBeUndefined();
    // Edit NOT blocked (not in custom list)
    expect(await gate(layer, "Edit")).toBeUndefined();
  });

  it("supports custom shouldBlock predicate", async () => {
    const state: PlanModeState = { isActive: false };
    const shouldBlock = vi.fn(
      (toolName: string, params: Record<string, unknown>) => {
        if (
          toolName === "Bash" &&
          typeof params.command === "string" &&
          params.command.includes("rm -rf")
        ) {
          return "Destructive command blocked";
        }
        return undefined;
      },
    );

    const layer = createExecutionPolicy(state, { shouldBlock });

    // Safe command allowed
    expect(
      await gate(layer, "Bash", { command: "echo hello" }),
    ).toBeUndefined();

    // Destructive command blocked
    const result = await gate(layer, "Bash", { command: "rm -rf /" });
    expect(result).toBeDefined();
    expect(result!.error).toBe("Destructive command blocked");
    expect(shouldBlock).toHaveBeenCalledTimes(2);
  });

  it("plan mode gate takes priority over shouldBlock", async () => {
    const state: PlanModeState = { isActive: true };
    const shouldBlock = vi.fn(() => undefined);

    const layer = createExecutionPolicy(state, { shouldBlock });

    // Plan mode blocks before shouldBlock is even called
    const result = await gate(layer, "Bash");
    expect(result).toBeDefined();
    expect(result!.error).toContain("not available in plan mode");
    expect(shouldBlock).not.toHaveBeenCalled();
  });

  it("shouldBlock runs when plan mode allows the tool", async () => {
    const state: PlanModeState = { isActive: true };
    const shouldBlock = vi.fn(() => "custom block");

    const layer = createExecutionPolicy(state, { shouldBlock });

    // Read is allowed by plan mode, so shouldBlock runs
    const result = await gate(layer, "Read");
    expect(result).toBeDefined();
    expect(result!.error).toBe("custom block");
    expect(shouldBlock).toHaveBeenCalledWith("Read", {});
  });

  it("error message includes guidance about read-only tools", async () => {
    const state: PlanModeState = { isActive: true };
    const layer = createExecutionPolicy(state);

    const result = await gate(layer, "Bash");
    expect(result!.error).toContain("Read");
    expect(result!.error).toContain("Grep");
    expect(result!.error).toContain("Glob");
    expect(result!.error).toContain("ExitPlanMode");
  });
});
