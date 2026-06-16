export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type RuntimeEventType =
  | "thread.started"
  | "turn.started"
  | "turn.completed"
  | "turn.failed"
  | "agent.created"
  | "agent.started"
  | "agent.status_changed"
  | "agent.message_queued"
  | "agent.completed"
  | "agent.failed"
  | "agent.interrupted"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "plan.updated"
  | "file.changed"
  | "command.output"
  | "approval.requested"
  | "approval.resolved"
  | "approval.rejected"
  | "cost.updated";

export interface RuntimeEventBase {
  type: RuntimeEventType;
  timestamp: string;
  thread_id?: string | null;
  turn_id?: string | null;
  agent_id?: string | null;
  parent_agent_id?: string | null;
  metadata?: JsonObject;
}

export interface RuntimeUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_cost_usd?: number;
}

export interface ThreadStartedEvent extends RuntimeEventBase {
  type: "thread.started";
  thread_id: string;
}

export interface TurnStartedEvent extends RuntimeEventBase {
  type: "turn.started";
  turn_id: string;
}

export interface TurnCompletedEvent extends RuntimeEventBase {
  type: "turn.completed";
  turn_id: string;
  usage?: RuntimeUsage;
}

export interface TurnFailedEvent extends RuntimeEventBase {
  type: "turn.failed";
  turn_id: string;
  error: string;
}

export type AgentStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "interrupted";

export interface AgentLifecycleEvent extends RuntimeEventBase {
  type:
    | "agent.created"
    | "agent.started"
    | "agent.status_changed"
    | "agent.message_queued"
    | "agent.completed"
    | "agent.failed"
    | "agent.interrupted";
  agent_id: string;
  parent_agent_id: string | null;
  status: AgentStatus;
  task_name?: string | null;
  profile?: string | null;
  message?: string | null;
  error?: string | null;
}

export interface ToolStartedEvent extends RuntimeEventBase {
  type: "tool.started";
  tool_call_id: string;
  tool_name: string;
  input?: JsonObject;
}

export interface ToolCompletedEvent extends RuntimeEventBase {
  type: "tool.completed";
  tool_call_id: string;
  tool_name: string;
  output?: JsonValue;
  duration_ms?: number;
}

export interface ToolFailedEvent extends RuntimeEventBase {
  type: "tool.failed";
  tool_call_id: string;
  tool_name: string;
  error: string;
  duration_ms?: number;
}

export type PlanItemStatus = "pending" | "in_progress" | "completed";

export interface PlanItem {
  step: string;
  status: PlanItemStatus;
}

export interface PlanStats {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
}

export interface PlanSnapshot {
  explanation: string | null;
  plan: PlanItem[];
  stats: PlanStats;
  updated_at: string | null;
}

export interface PlanUpdatedEvent extends RuntimeEventBase {
  type: "plan.updated";
  explanation: string | null;
  plan: PlanItem[];
  stats: PlanStats;
}

export type FileChangeKind = "created" | "modified" | "deleted";

export interface FileChangedEvent extends RuntimeEventBase {
  type: "file.changed";
  path: string;
  change: FileChangeKind;
  unified_diff?: string | null;
  tool_call_id?: string | null;
  tool_name?: string | null;
}

export interface CommandOutputEvent extends RuntimeEventBase {
  type: "command.output";
  command_id: string;
  stream: "stdout" | "stderr";
  chunk: string;
}

export type ApprovalSubject =
  | {
      type: "tool";
      tool_name: string;
      tool_call_id?: string | null;
      input?: JsonObject;
    }
  | {
      type: "command";
      command: string;
      cwd?: string | null;
    }
  | {
      type: "file_change";
      path: string;
      change: FileChangeKind;
    }
  | {
      type: "permission";
      permission: string;
    };

export type ApprovalDecision =
  | "approved"
  | "approved_for_session"
  | "rejected"
  | "cancelled";

export interface ApprovalRequest {
  approval_id: string;
  subject: ApprovalSubject;
  reason: string | null;
  requested_at: string;
  agent_id?: string | null;
  thread_id?: string | null;
  turn_id?: string | null;
  metadata?: JsonObject;
}

export interface ApprovalResult {
  approval_id: string;
  decision: ApprovalDecision;
  reason: string | null;
  resolved_at: string;
  metadata?: JsonObject;
}

export interface ApprovalRequestedEvent extends RuntimeEventBase {
  type: "approval.requested";
  approval: ApprovalRequest;
}

export interface ApprovalResolvedEvent extends RuntimeEventBase {
  type: "approval.resolved" | "approval.rejected";
  approval: ApprovalRequest;
  result: ApprovalResult;
}

export interface CostUpdatedEvent extends RuntimeEventBase {
  type: "cost.updated";
  usage: RuntimeUsage;
}

export type RuntimeEvent =
  | ThreadStartedEvent
  | TurnStartedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | AgentLifecycleEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ToolFailedEvent
  | PlanUpdatedEvent
  | FileChangedEvent
  | CommandOutputEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | CostUpdatedEvent;

export interface RuntimeEventSink {
  emit(event: RuntimeEvent): void | Promise<void>;
  subscribe?(listener: RuntimeEventListener): () => void;
}

export type RuntimeEventListener = (
  event: RuntimeEvent,
) => void | Promise<void>;
