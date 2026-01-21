import { tool, zodSchema } from "ai";
import { z } from "zod";
import {
  debugEnd,
  debugError,
  debugStart,
  isDebugEnabled,
} from "../utils/debug";

export interface PlanModeState {
  isActive: boolean;
  enteredAt?: Date;
  reason?: string;
}

export interface EnterPlanModeOutput {
  message: string;
  mode: "planning";
}

export interface EnterPlanModeError {
  error: string;
}

const enterPlanModeInputSchema = z.object({
  reason: z
    .string()
    .describe(
      "Brief explanation of why you're entering planning mode (e.g., 'Need to explore codebase architecture before implementing feature')",
    ),
});

type EnterPlanModeInput = z.infer<typeof enterPlanModeInputSchema>;

const ENTER_PLAN_MODE_DESCRIPTION = `Use this tool proactively when you're about to start a non-trivial task. Getting user sign-off on your approach prevents wasted effort and ensures alignment. This tool transitions you into plan mode where you can explore and design an approach for user approval.

## When to Use This Tool

**Prefer using EnterPlanMode** for tasks unless they're simple. Use it when ANY of these conditions apply:

1. **New Functionality**: Adding meaningful new capabilities
   - Example: "Add a new report" - what format? What data?
   - Example: "Add validation" - what rules? What error messages?

2. **Multiple Valid Approaches**: The task can be solved in several different ways
   - Example: "Add caching" - could use Redis, in-memory, file-based, etc.
   - Example: "Improve performance" - many optimization strategies possible

3. **Modifications**: Changes that affect existing behavior or structure
   - Example: "Update the workflow" - what exactly should change?
   - Example: "Refactor this component" - what's the target architecture?

4. **Architectural Decisions**: The task requires choosing between patterns or technologies
   - Example: "Add real-time updates" - WebSockets vs SSE vs polling
   - Example: "Implement state management" - different approaches possible

5. **Multi-File Changes**: The task will likely touch more than 2-3 files

6. **Unclear Requirements**: You need to explore before understanding the full scope
   - Example: "Make this faster" - need to profile and identify bottlenecks
   - Example: "Fix the bug" - need to investigate root cause

7. **User Preferences Matter**: The approach could reasonably go multiple ways
   - If you would use AskUser to clarify the approach, use EnterPlanMode instead
   - Plan mode lets you explore first, then present options with context

## When NOT to Use This Tool

Only skip EnterPlanMode for simple tasks:
- Single-line or few-line fixes (typos, obvious bugs, small tweaks)
- Adding a single function with clear requirements
- Tasks where the user has given very specific, detailed instructions
- Pure research/exploration tasks

## What Happens in Plan Mode

In plan mode, you'll:
1. Thoroughly explore using Glob, Grep, and Read tools
2. Understand existing patterns and architecture
3. Design an approach
4. Present your plan to the user for approval
5. Use AskUser if you need to clarify approaches
6. Exit plan mode with ExitPlanMode when ready to execute

## Important Notes

- This tool REQUIRES user approval - they must consent to entering plan mode
- If unsure whether to use it, err on the side of planning - it's better to get alignment upfront than to redo work
- Users appreciate being consulted before significant changes`;

/**
 * Creates a tool for entering planning mode.
 * Works in conjunction with ExitPlanMode for plan-then-execute workflows.
 *
 * @param state - Shared state object to track planning mode
 * @param onEnter - Optional callback when entering planning mode
 */
export function createEnterPlanModeTool(
  state: PlanModeState,
  onEnter?: (reason: string) => void | Promise<void>,
) {
  return tool({
    description: ENTER_PLAN_MODE_DESCRIPTION,
    inputSchema: zodSchema(enterPlanModeInputSchema),
    execute: async ({
      reason,
    }: EnterPlanModeInput): Promise<
      EnterPlanModeOutput | EnterPlanModeError
    > => {
      const startTime = performance.now();
      const debugId = isDebugEnabled()
        ? debugStart("enter-plan-mode", { reason })
        : "";

      try {
        if (state.isActive) {
          const error = "Already in planning mode. Use ExitPlanMode to exit.";
          if (debugId) debugError(debugId, "enter-plan-mode", error);
          return { error };
        }

        state.isActive = true;
        state.enteredAt = new Date();
        state.reason = reason;

        if (onEnter) {
          await onEnter(reason);
        }

        const durationMs = Math.round(performance.now() - startTime);
        if (debugId) {
          debugEnd(debugId, "enter-plan-mode", {
            summary: { mode: "planning" },
            duration_ms: durationMs,
          });
        }

        return {
          message: `Entered planning mode: ${reason}. Use Read, Grep, and Glob to explore. Call ExitPlanMode when ready with a plan.`,
          mode: "planning",
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (debugId) debugError(debugId, "enter-plan-mode", errorMessage);
        return { error: errorMessage };
      }
    },
  });
}
