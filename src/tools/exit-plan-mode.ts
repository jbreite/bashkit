import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { ToolConfig } from "../types";

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

export function createExitPlanModeTool(
  config?: ToolConfig,
  onPlanSubmit?: (plan: string) => Promise<boolean> | boolean
) {
  if (config?.enabled === false) return null;

  return tool({
    description:
      "Exits planning mode and prompts the user to approve the plan. Use this when you have finished planning and want user confirmation before proceeding.",
    inputSchema: zodSchema(exitPlanModeInputSchema),
    execute: async ({
      plan,
    }: ExitPlanModeInput): Promise<ExitPlanModeOutput | ExitPlanModeError> => {
      try {
        let approved: boolean | undefined;

        // If a callback is provided, use it to get approval
        if (onPlanSubmit) {
          approved = await onPlanSubmit(plan);
        }

        return {
          message: approved
            ? "Plan approved, proceeding with execution"
            : "Plan submitted for review",
          approved,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
