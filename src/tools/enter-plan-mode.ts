import { tool, zodSchema } from "ai";
import { z } from "zod";

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

const ENTER_PLAN_MODE_DESCRIPTION = `Enter planning mode to explore and design implementation approaches before making changes.

**When to use:**
- Complex tasks requiring research or exploration
- Need to understand codebase structure before implementing
- Multiple approaches possible and you need to evaluate trade-offs
- User explicitly asks you to plan before executing

**In planning mode:**
- Focus on reading, searching, and understanding
- Avoid making file changes (use Read, Grep, Glob instead of Write, Edit)
- Document your findings and proposed approach
- Use ExitPlanMode when ready with a plan for user approval

**When NOT to use:**
- Simple, well-defined tasks
- You already understand the codebase and approach
- User wants immediate execution`;

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
      try {
        if (state.isActive) {
          return {
            error: "Already in planning mode. Use ExitPlanMode to exit.",
          };
        }

        state.isActive = true;
        state.enteredAt = new Date();
        state.reason = reason;

        if (onEnter) {
          await onEnter(reason);
        }

        return {
          message: `Entered planning mode: ${reason}. Use Read, Grep, and Glob to explore. Call ExitPlanMode when ready with a plan.`,
          mode: "planning",
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
