import type {
  SubagentMetadata,
  SubagentModelInfo,
  SubagentRunResult,
  SubagentStatus,
} from "../../subagents";

export interface SubagentControlToolConfig {
  /**
   * Current agent id, when these tools are exposed to a child. Used to reject
   * self-targeting follow-up work that would deadlock the caller.
   */
  currentAgentId?: string;
}

export interface SubagentToolError {
  error: string;
}

export interface CompactSubagentRecord {
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
  usage?: SubagentMetadata["usage"];
  result_ref?: string;
  transcript_ref?: string;
}

export interface SpawnAgentOutput {
  agent_id: string;
  task_name: string | null;
  status: SubagentStatus;
  profile: string;
  nickname: string | null;
  model: SubagentModelInfo;
}

export interface ListAgentsOutput {
  agents: CompactSubagentRecord[];
}

export interface WaitAgentOutput {
  status: "ready" | "timeout";
  agent: CompactSubagentRecord;
  result?: SubagentRunResult;
}

export interface MessageAgentOutput {
  queued: boolean;
  agent_id: string;
  message_id: string;
  triggered_turn: boolean;
}

export interface InterruptAgentOutput {
  agent_id: string;
  previous_status: SubagentStatus;
  status: SubagentStatus;
}

export function compactSubagentRecord(
  metadata: SubagentMetadata,
): CompactSubagentRecord {
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
  };
}
