import { tool, zodSchema } from "ai";
import { z } from "zod";
import {
  debugEnd,
  debugError,
  debugStart,
  isDebugEnabled,
} from "../utils/debug";

export interface ExitPlanModeOutput {
  message: string;
  approved?: boolean;
}

export interface ExitPlanModeError {
  error: string;
}

const exitPlanModeInputSchema = z.object({
  plan: z.string().describe("The plan to present to the user for approval"),
});

type ExitPlanModeInput = z.infer<typeof exitPlanModeInputSchema>;

const EXIT_PLAN_MODE_DESCRIPTION = `Use this tool when you are in plan mode and have finished planning and are ready for user approval.

## How This Tool Works
- Pass your completed plan as a parameter
- This tool signals that you're done planning and ready for the user to review
- The user will see your plan and can approve or request changes

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning implementation steps. For research tasks where you're gathering information, searching files, or understanding the codebase - do NOT use this tool.

## Handling Ambiguity in Plans
Before using this tool, ensure your plan is clear and unambiguous. If there are multiple valid approaches or unclear requirements:
1. Ask the user to clarify (use AskUser tool if available)
2. Ask about specific implementation choices (e.g., architectural patterns, which library to use)
3. Clarify any assumptions that could affect the implementation
4. Only proceed with ExitPlanMode after resolving ambiguities

## Examples
1. "Search for and understand the implementation of X" - Do NOT use this tool (research task)
2. "Help me implement feature Y" - Use this tool after planning the implementation steps
3. "Add user authentication" - If unsure about approach (OAuth vs JWT), clarify first, then use this tool`;

export function createExitPlanModeTool(
  onPlanSubmit?: (plan: string) => Promise<boolean> | boolean,
) {
  return tool({
    description: EXIT_PLAN_MODE_DESCRIPTION,
    inputSchema: zodSchema(exitPlanModeInputSchema),
    execute: async ({
      plan,
    }: ExitPlanModeInput): Promise<ExitPlanModeOutput | ExitPlanModeError> => {
      const startTime = performance.now();
      const debugId = isDebugEnabled()
        ? debugStart("exit-plan-mode", {
            planLength: plan.length,
            planPreview: plan.length > 200 ? `${plan.slice(0, 200)}...` : plan,
          })
        : "";

      try {
        let approved: boolean | undefined;

        // If a callback is provided, use it to get approval
        if (onPlanSubmit) {
          approved = await onPlanSubmit(plan);
        }

        const durationMs = Math.round(performance.now() - startTime);
        if (debugId) {
          debugEnd(debugId, "exit-plan-mode", {
            summary: { approved },
            duration_ms: durationMs,
          });
        }

        return {
          message: approved
            ? "Plan approved, proceeding with execution"
            : "Plan submitted for review",
          approved,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (debugId) debugError(debugId, "exit-plan-mode", errorMessage);
        return { error: errorMessage };
      }
    },
  });
}
