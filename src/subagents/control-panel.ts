import type { BudgetStatus } from "../utils/budget-tracking";
import { isActiveSubagentStatus, isTerminalSubagentStatus } from "./status";
import type {
  SubagentEvent,
  SubagentMetadata,
  SubagentModelInfo,
  SubagentRecord,
  SubagentRunnerCapabilities,
  SubagentStatus,
  SubagentUsage,
} from "./types";

export type SubagentControlPanelAction =
  | "wait"
  | "message"
  | "followup"
  | "interrupt";

export interface SubagentControlPanelAgent {
  agent_id: string;
  task_name: string | null;
  profile: string;
  nickname: string | null;
  model: SubagentModelInfo;
  status: SubagentStatus;
  parent_id: string | null;
  depth: number;
  last_task_message: string | null;
  created_at: string;
  updated_at: string;
  usage?: SubagentUsage;
  result_ref?: string;
  transcript_ref?: string;
  error?: string;
  supported_actions: SubagentControlPanelAction[];
}

export interface SubagentControlPanelStats {
  total: number;
  active: number;
  terminal: number;
  completed: number;
  failed: number;
  interrupted: number;
}

export interface SubagentControlPanelState {
  active_agents: SubagentControlPanelAgent[];
  terminal_agents: SubagentControlPanelAgent[];
  recent_events: SubagentEvent[];
  stats: SubagentControlPanelStats;
  budget?: BudgetStatus;
  warnings: string[];
}

export interface SubagentControlPanelOptions {
  records: readonly SubagentRecord[];
  capabilities?: Partial<SubagentRunnerCapabilities>;
  budget?: BudgetStatus;
  recentEventLimit?: number;
}

function supportedActions(
  metadata: SubagentMetadata,
  capabilities: Partial<SubagentRunnerCapabilities>,
): SubagentControlPanelAction[] {
  const actions: SubagentControlPanelAction[] = ["wait"];
  if (!isActiveSubagentStatus(metadata.status)) return actions;

  actions.push("message");
  if (capabilities.followup) actions.push("followup");
  if (capabilities.interrupt) actions.push("interrupt");
  return actions;
}

function compactAgent(
  record: SubagentRecord,
  capabilities: Partial<SubagentRunnerCapabilities>,
): SubagentControlPanelAgent {
  const { metadata, result } = record;
  return {
    agent_id: metadata.agent_id,
    task_name: metadata.task_name,
    profile: metadata.profile,
    nickname: metadata.nickname,
    model: metadata.model,
    status: metadata.status,
    parent_id: metadata.parent_id,
    depth: metadata.depth,
    last_task_message: metadata.last_task_message,
    created_at: metadata.created_at,
    updated_at: metadata.updated_at,
    usage: metadata.usage,
    result_ref: metadata.result_ref,
    transcript_ref: metadata.transcript_ref,
    error: result?.error,
    supported_actions: supportedActions(metadata, capabilities),
  };
}

function statsFor(
  records: readonly SubagentRecord[],
): SubagentControlPanelStats {
  let active = 0;
  let completed = 0;
  let failed = 0;
  let interrupted = 0;

  for (const record of records) {
    const status = record.metadata.status;
    if (isActiveSubagentStatus(status)) active += 1;
    if (status === "completed") completed += 1;
    if (status === "failed") failed += 1;
    if (status === "interrupted") interrupted += 1;
  }

  return {
    total: records.length,
    active,
    terminal: completed + failed + interrupted,
    completed,
    failed,
    interrupted,
  };
}

function warningsFor(budget: BudgetStatus | undefined): string[] {
  if (!budget) return [];

  const warnings: string[] = [];
  if (budget.exceeded) warnings.push("Budget exceeded");
  if (budget.unpricedSteps > 0) {
    warnings.push(`${budget.unpricedSteps} unpriced step(s)`);
  }
  return warnings;
}

function recentEvents(
  records: readonly SubagentRecord[],
  limit: number,
): SubagentEvent[] {
  return records
    .flatMap((record) => record.events)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-limit)
    .map((event) => ({ ...event, payload: event.payload }));
}

export function createSubagentControlPanelState(
  options: SubagentControlPanelOptions,
): SubagentControlPanelState {
  const capabilities = options.capabilities ?? {};
  const activeAgents: SubagentControlPanelAgent[] = [];
  const terminalAgents: SubagentControlPanelAgent[] = [];

  for (const record of options.records) {
    const agent = compactAgent(record, capabilities);
    if (isTerminalSubagentStatus(record.metadata.status)) {
      terminalAgents.push(agent);
    } else {
      activeAgents.push(agent);
    }
  }

  return {
    active_agents: activeAgents,
    terminal_agents: terminalAgents,
    recent_events: recentEvents(
      options.records,
      options.recentEventLimit ?? 25,
    ),
    stats: statsFor(options.records),
    budget: options.budget,
    warnings: warningsFor(options.budget),
  };
}
