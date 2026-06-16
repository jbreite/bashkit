import { tool, zodSchema } from "ai";
import { z } from "zod";
import type {
  PlanState,
  PlanUpdateContext,
  RuntimeEventSink,
} from "../runtime";
import { updatePlanState } from "../runtime";
import type { SDKToolOptions } from "../types";
import {
  debugEnd,
  debugError,
  debugStart,
  isDebugEnabled,
} from "../utils/debug";
import type { PlanModeState } from "./enter-plan-mode";

const updatePlanInputSchema = z.object({
  explanation: z
    .string()
    .nullable()
    .default(null)
    .describe("Optional explanation for this plan update."),
  plan: z
    .array(
      z.object({
        step: z.string().describe("Task step text."),
        status: z
          .enum(["pending", "in_progress", "completed"])
          .describe("Step status."),
      }),
    )
    .describe("The list of steps"),
});

type UpdatePlanInput = z.infer<typeof updatePlanInputSchema>;

export interface UpdatePlanOutput {
  message: string;
  stats: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
  };
}

export interface UpdatePlanError {
  error: string;
}

export type UpdatePlanToolConfig = SDKToolOptions & {
  eventSink?: RuntimeEventSink;
  context?: PlanUpdateContext;
  planModeState?: PlanModeState;
};

const UPDATE_PLAN_DESCRIPTION = `Updates the task plan.
Provide an optional explanation and a list of plan items, each with a step and status.
At most one step can be in_progress at a time.`;

export function createUpdatePlanTool(
  state: PlanState,
  config?: UpdatePlanToolConfig,
) {
  const { eventSink, context, planModeState, ...toolOptions } = config ?? {};

  return tool({
    description: UPDATE_PLAN_DESCRIPTION,
    inputSchema: zodSchema(updatePlanInputSchema),
    ...toolOptions,
    execute: async ({
      explanation,
      plan,
    }: UpdatePlanInput): Promise<UpdatePlanOutput | UpdatePlanError> => {
      const startTime = performance.now();
      const debugId = isDebugEnabled()
        ? debugStart("update-plan", {
            stepCount: plan.length,
            pending: plan.filter((item) => item.status === "pending").length,
            in_progress: plan.filter((item) => item.status === "in_progress")
              .length,
            completed: plan.filter((item) => item.status === "completed")
              .length,
          })
        : "";

      try {
        if (planModeState?.isActive) {
          return {
            error:
              "UpdatePlan is a checklist/progress tool and is not allowed in Plan mode",
          };
        }

        const result = await updatePlanState(
          state,
          { explanation, plan },
          {
            eventSink,
            context,
          },
        );
        if ("error" in result) return result;

        const durationMs = Math.round(performance.now() - startTime);
        if (debugId) {
          debugEnd(debugId, "update-plan", {
            summary: { ...result.snapshot.stats },
            duration_ms: durationMs,
          });
        }

        return {
          message: result.message,
          stats: result.snapshot.stats,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (debugId) debugError(debugId, "update-plan", errorMessage);
        return { error: errorMessage };
      }
    },
  });
}
