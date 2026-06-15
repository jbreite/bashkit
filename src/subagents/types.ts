import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import type { BudgetStatus, BudgetTracker } from "../utils/budget-tracking";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface SubagentError {
  error: string;
}

export type SubagentId = string;
export type SubagentPath = string;

export type SubagentStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "interrupted";

export interface SubagentHandle {
  agent_id: SubagentId;
  task_name: SubagentPath | null;
}

export interface SubagentUsage {
  totalCostUsd?: number;
  stepsCompleted?: number;
  unpricedSteps?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface SubagentRunResult {
  agent_id: SubagentId;
  task_name: SubagentPath | null;
  status: Extract<SubagentStatus, "completed" | "failed" | "interrupted">;
  result?: string;
  error?: string;
  usage?: SubagentUsage;
  result_ref?: string;
  transcript_ref?: string;
  metadata?: JsonObject;
}

export type SubagentContextPolicy =
  | { mode: "none" }
  | { mode: "all" }
  | { mode: "recent"; turns: number };

export type SubagentContextPolicyInput =
  | "none"
  | "all"
  | { recent_turns: number }
  | SubagentContextPolicy;

export interface SubagentCodemodePolicy {
  enabled: boolean;
  exposeDirectTools: boolean;
  includeTools?: string[];
  excludeTools?: string[];
}

export interface SubagentProfileInput {
  name: string;
  description?: string;
  nickname?: string;
  model?: LanguageModel;
  system?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  codemode?: Partial<SubagentCodemodePolicy>;
  context?: SubagentContextPolicyInput;
  cost?: SubagentCostPolicyInput;
  metadata?: JsonObject;
}

export interface SubagentProfileDefaults {
  model?: LanguageModel;
  system?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  codemode?: Partial<SubagentCodemodePolicy>;
  context?: SubagentContextPolicyInput;
  cost?: SubagentCostPolicyInput;
}

export interface ResolvedSubagentProfile {
  name: string;
  description: string;
  nickname: string | null;
  model?: LanguageModel;
  system: string;
  allowedTools: readonly string[];
  deniedTools: readonly string[];
  codemode: SubagentCodemodePolicy;
  context: SubagentContextPolicy;
  cost: SubagentCostPolicy;
  metadata: JsonObject;
}

export interface SubagentMetadata {
  agent_id: SubagentId;
  task_name: SubagentPath | null;
  profile: string;
  nickname: string | null;
  status: SubagentStatus;
  parent_id: SubagentId | null;
  depth: number;
  last_task_message: string | null;
  created_at: string;
  updated_at: string;
  usage?: SubagentUsage;
  result_ref?: string;
  transcript_ref?: string;
  metadata?: JsonObject;
}

export interface SubagentMetadataPatch {
  status?: SubagentStatus;
  last_task_message?: string | null;
  usage?: SubagentUsage;
  result_ref?: string;
  transcript_ref?: string;
  metadata?: JsonObject;
}

export type SubagentEventType =
  | "subagent.created"
  | "subagent.started"
  | "subagent.status_changed"
  | "subagent.message_queued"
  | "subagent.tool_call"
  | "subagent.tool_result"
  | "subagent.usage"
  | "subagent.completed"
  | "subagent.failed"
  | "subagent.interrupted";

export interface SubagentEvent {
  type: SubagentEventType;
  agent_id: SubagentId;
  task_name: SubagentPath | null;
  parent_id: SubagentId | null;
  profile: string;
  status: SubagentStatus;
  timestamp: string;
  payload?: JsonObject;
}

export interface SubagentEventSink {
  emit(event: SubagentEvent): void | Promise<void>;
}

export interface SubagentMailboxMessage {
  id: string;
  agent_id: SubagentId;
  message: string;
  kind: "message" | "followup";
  trigger_turn: boolean;
  created_at: string;
  metadata?: JsonObject;
}

export interface SubagentRecord {
  metadata: SubagentMetadata;
  result?: SubagentRunResult;
  events: SubagentEvent[];
  mailbox: SubagentMailboxMessage[];
}

export interface SubagentListFilter {
  status?: SubagentStatus;
  pathPrefix?: string;
  includeTerminal?: boolean;
  limit?: number;
}

export interface SubagentStore {
  create(metadata: SubagentMetadata): Promise<void>;
  update(
    handle: SubagentHandle,
    patch: SubagentMetadataPatch,
  ): Promise<SubagentMetadata | SubagentError>;
  appendEvent(event: SubagentEvent): Promise<void>;
  appendMessage(message: SubagentMailboxMessage): Promise<void>;
  complete(
    handle: SubagentHandle,
    result: SubagentRunResult,
  ): Promise<SubagentMetadata | SubagentError>;
  get(handle: SubagentHandle): Promise<SubagentRecord | null>;
  list(filter?: SubagentListFilter): Promise<SubagentRecord[]>;
}

export interface SubagentProfileRegistry {
  register(profile: SubagentProfileInput): void;
  has(name: string): boolean;
  resolve(
    name: string | undefined,
    overrides?: Partial<SubagentProfileInput>,
  ): ResolvedSubagentProfile | SubagentError;
}

export interface SubagentRegistry {
  reserve(
    request: SubagentReservationRequest,
  ): SubagentMetadata | SubagentError;
  get(handleOrRef: SubagentHandle | string): SubagentMetadata | null;
  updateStatus(
    handle: SubagentHandle,
    status: SubagentStatus,
  ): SubagentMetadata | SubagentError;
  release(handle: SubagentHandle): void;
  list(): SubagentMetadata[];
}

export interface SubagentRunnerCapabilities {
  interrupt: boolean;
  followup: boolean;
}

export interface ResolvedSubagentRunRequest {
  handle: SubagentHandle;
  task: string;
  profile: ResolvedSubagentProfile;
  parent_id: SubagentId | null;
  depth: number;
  tools: ToolSet;
  messages?: ModelMessage[];
  metadata?: JsonObject;
  signal?: AbortSignal;
  callbacks: SubagentRunnerCallbacks;
}

export interface SubagentRunnerCallbacks {
  onStatus(status: SubagentStatus): void | Promise<void>;
  onEvent(event: Omit<SubagentEvent, "timestamp">): void | Promise<void>;
  onUsage(usage: SubagentUsage): void | Promise<void>;
}

export interface SubagentRunner {
  capabilities: SubagentRunnerCapabilities;
  run(request: ResolvedSubagentRunRequest): Promise<SubagentRunResult>;
  interrupt?(
    handle: SubagentHandle,
  ): Promise<SubagentInterruptResult | SubagentError>;
  requestTurn?(
    handle: SubagentHandle,
  ): Promise<SubagentMessageResult | SubagentError>;
}

export interface SubagentSpawnRequest {
  task: string;
  profile?: string;
  task_name?: string | null;
  parent_id?: SubagentId | null;
  context?: SubagentContextPolicyInput;
  tools?: string[] | null;
  metadata?: JsonObject;
  messages?: ModelMessage[];
}

export type SubagentSpawnResult = SubagentHandle & {
  status: SubagentStatus;
  profile: string;
  nickname: string | null;
};

export interface SubagentWaitRequest {
  agent: string;
  timeoutMs?: number | null;
  untilStatus?: SubagentStatus | null;
}

export type SubagentWaitResult =
  | {
      status: "timeout";
      agent: SubagentMetadata;
    }
  | {
      status: "ready";
      agent: SubagentMetadata;
      result?: SubagentRunResult;
    };

export interface SubagentMessageRequest {
  agent: string;
  message: string;
  metadata?: JsonObject;
}

export interface SubagentFollowupRequest extends SubagentMessageRequest {
  task: string;
}

export interface SubagentMessageResult {
  queued: boolean;
  agent_id: SubagentId;
  message_id: string;
  triggered_turn: boolean;
}

export interface SubagentInterruptRequest {
  agent: string;
  reason?: string | null;
}

export interface SubagentInterruptResult {
  agent_id: SubagentId;
  previous_status: SubagentStatus;
  status: SubagentStatus;
}

export interface SubagentLifecycleHooks {
  onBeforeSpawn?(
    request: SubagentSpawnRequest,
  ): Promise<SubagentError | undefined> | SubagentError | undefined;
  onStart?(metadata: SubagentMetadata): void | Promise<void>;
  onMessage?(message: SubagentMailboxMessage): void | Promise<void>;
  onComplete?(result: SubagentRunResult): void | Promise<void>;
  onFail?(result: SubagentRunResult): void | Promise<void>;
  onInterrupt?(result: SubagentInterruptResult): void | Promise<void>;
  onStop?(result: SubagentRunResult): void | Promise<void>;
}

export interface SubagentCostPolicyInput {
  maxUsd?: number;
  maxActiveAgents?: number;
  maxTotalAgents?: number;
  maxDepth?: number;
  maxMailboxMessages?: number;
  minWaitTimeoutMs?: number;
  maxWaitTimeoutMs?: number;
}

export interface SubagentCostPolicy {
  maxUsd: number | null;
  maxActiveAgents: number;
  maxTotalAgents: number;
  maxDepth: number;
  maxMailboxMessages: number;
  minWaitTimeoutMs: number;
  maxWaitTimeoutMs: number;
}

export interface SubagentPolicyState {
  activeAgents: number;
  totalAgents: number;
  depth: number;
  mailboxMessages: number;
  budgetStatus?: BudgetStatus;
}

export interface SubagentControllerConfig {
  profiles?: SubagentProfileInput[];
  defaultProfile?: string;
  profileDefaults?: SubagentProfileDefaults;
  store?: SubagentStore;
  runner: SubagentRunner;
  tools?: ToolSet;
  eventSink?: SubagentEventSink;
  lifecycle?: SubagentLifecycleHooks;
  budget?: BudgetTracker;
  cost?: SubagentCostPolicyInput;
}

export interface SubagentReservationRequest {
  taskName?: string | null;
  profile: string;
  nickname: string | null;
  parentId?: SubagentId | null;
  depth: number;
  lastTaskMessage: string;
  metadata?: JsonObject;
}

export interface SubagentController {
  spawn(
    request: SubagentSpawnRequest,
  ): Promise<SubagentSpawnResult | SubagentError>;
  list(filter?: SubagentListFilter): Promise<SubagentMetadata[]>;
  wait(
    request: SubagentWaitRequest,
  ): Promise<SubagentWaitResult | SubagentError>;
  sendMessage(
    request: SubagentMessageRequest,
  ): Promise<SubagentMessageResult | SubagentError>;
  followupTask(
    request: SubagentFollowupRequest,
  ): Promise<SubagentMessageResult | SubagentError>;
  interrupt(
    request: SubagentInterruptRequest,
  ): Promise<SubagentInterruptResult | SubagentError>;
}
