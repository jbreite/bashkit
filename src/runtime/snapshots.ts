import type {
  AgentLifecycleEvent,
  AgentStatus,
  FileChangeKind,
  PlanSnapshot,
  RuntimeEvent,
} from "./types";

export interface AgentActivitySnapshot {
  agent_id: string;
  parent_agent_id: string | null;
  status: AgentStatus;
  task_name: string | null;
  profile: string | null;
  message: string | null;
  error: string | null;
  updated_at: string;
}

export interface ChangesSnapshotItem {
  path: string;
  change: FileChangeKind;
  unified_diff: string | null;
  updated_at: string;
}

export interface ProgressSnapshot {
  plan: PlanSnapshot | null;
  agents: AgentActivitySnapshot[];
  changes: ChangesSnapshotItem[];
}

function isAgentLifecycleEvent(
  event: RuntimeEvent,
): event is AgentLifecycleEvent {
  return event.type.startsWith("agent.");
}

export function projectPlanSnapshot(
  events: readonly RuntimeEvent[],
): PlanSnapshot | null {
  const latest = [...events]
    .reverse()
    .find((event) => event.type === "plan.updated");
  if (!latest || latest.type !== "plan.updated") return null;
  return {
    explanation: latest.explanation,
    plan: latest.plan.map((item) => ({ ...item })),
    stats: { ...latest.stats },
    updated_at: latest.timestamp,
  };
}

export function projectAgentActivitySnapshot(
  events: readonly RuntimeEvent[],
): AgentActivitySnapshot[] {
  const agents = new Map<string, AgentActivitySnapshot>();

  for (const event of events) {
    if (!isAgentLifecycleEvent(event)) continue;
    agents.set(event.agent_id, {
      agent_id: event.agent_id,
      parent_agent_id: event.parent_agent_id,
      status: event.status,
      task_name: event.task_name ?? null,
      profile: event.profile ?? null,
      message: event.message ?? null,
      error: event.error ?? null,
      updated_at: event.timestamp,
    });
  }

  return [...agents.values()].sort((left, right) =>
    left.updated_at.localeCompare(right.updated_at),
  );
}

export function projectChangesSnapshot(
  events: readonly RuntimeEvent[],
): ChangesSnapshotItem[] {
  const changes = new Map<string, ChangesSnapshotItem>();

  for (const event of events) {
    if (event.type !== "file.changed") continue;
    changes.set(event.path, {
      path: event.path,
      change: event.change,
      unified_diff: event.unified_diff ?? null,
      updated_at: event.timestamp,
    });
  }

  return [...changes.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

export function projectProgressSnapshot(
  events: readonly RuntimeEvent[],
): ProgressSnapshot {
  return {
    plan: projectPlanSnapshot(events),
    agents: projectAgentActivitySnapshot(events),
    changes: projectChangesSnapshot(events),
  };
}
