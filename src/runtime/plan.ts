import { createRuntimeEvent } from "./events";
import type {
  PlanItem,
  PlanSnapshot,
  PlanStats,
  PlanUpdatedEvent,
  RuntimeEventSink,
} from "./types";

export interface PlanState {
  explanation: string | null;
  plan: PlanItem[];
  updated_at: string | null;
}

export interface PlanUpdateInput {
  explanation?: string | null;
  plan: PlanItem[];
}

export interface PlanUpdateResult {
  message: string;
  snapshot: PlanSnapshot;
}

export interface PlanUpdateError {
  error: string;
}

export interface PlanUpdateContext {
  agent_id?: string | null;
  thread_id?: string | null;
  turn_id?: string | null;
  parent_agent_id?: string | null;
}

export function createPlanState(initial?: Partial<PlanState>): PlanState {
  return {
    explanation: initial?.explanation ?? null,
    plan: initial?.plan ? [...initial.plan] : [],
    updated_at: initial?.updated_at ?? null,
  };
}

export function getPlanStats(plan: readonly PlanItem[]): PlanStats {
  return {
    total: plan.length,
    pending: plan.filter((item) => item.status === "pending").length,
    in_progress: plan.filter((item) => item.status === "in_progress").length,
    completed: plan.filter((item) => item.status === "completed").length,
  };
}

export function snapshotPlanState(state: PlanState): PlanSnapshot {
  return {
    explanation: state.explanation,
    plan: state.plan.map((item) => ({ ...item })),
    stats: getPlanStats(state.plan),
    updated_at: state.updated_at,
  };
}

export function validatePlanUpdate(
  input: PlanUpdateInput,
): PlanUpdateError | null {
  const inProgressCount = input.plan.filter(
    (item) => item.status === "in_progress",
  ).length;
  if (inProgressCount > 1) {
    return { error: "At most one plan item can be in_progress" };
  }

  const emptyStep = input.plan.find((item) => item.step.trim().length === 0);
  if (emptyStep) return { error: "Plan item step cannot be empty" };

  return null;
}

export function createPlanUpdatedEvent(
  snapshot: PlanSnapshot,
  context?: PlanUpdateContext,
): PlanUpdatedEvent {
  return createRuntimeEvent({
    type: "plan.updated",
    explanation: snapshot.explanation,
    plan: snapshot.plan,
    stats: snapshot.stats,
    agent_id: context?.agent_id ?? null,
    parent_agent_id: context?.parent_agent_id ?? null,
    thread_id: context?.thread_id ?? null,
    turn_id: context?.turn_id ?? null,
  }) as PlanUpdatedEvent;
}

export async function updatePlanState(
  state: PlanState,
  input: PlanUpdateInput,
  options?: {
    eventSink?: RuntimeEventSink;
    context?: PlanUpdateContext;
  },
): Promise<PlanUpdateResult | PlanUpdateError> {
  const validation = validatePlanUpdate(input);
  if (validation) return validation;

  state.explanation = input.explanation ?? null;
  state.plan = input.plan.map((item) => ({ ...item }));
  state.updated_at = new Date().toISOString();

  const snapshot = snapshotPlanState(state);
  await options?.eventSink?.emit(
    createPlanUpdatedEvent(snapshot, options.context),
  );

  return {
    message: "Plan updated",
    snapshot,
  };
}
