import { createRuntimeEvent } from "./events";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  ApprovalResult,
  ApprovalSubject,
  JsonObject,
} from "./types";

let approvalIdCounter = 0;

export function createApprovalId(prefix = "approval"): string {
  approvalIdCounter += 1;
  return `${prefix}_${approvalIdCounter.toString(36).padStart(4, "0")}`;
}

export function resetApprovalIdCounterForTests(): void {
  approvalIdCounter = 0;
}

export function createApprovalRequest(input: {
  subject: ApprovalSubject;
  reason?: string | null;
  approvalId?: string;
  agentId?: string | null;
  threadId?: string | null;
  turnId?: string | null;
  metadata?: JsonObject;
}): ApprovalRequest {
  return {
    approval_id: input.approvalId ?? createApprovalId(),
    subject: input.subject,
    reason: input.reason ?? null,
    requested_at: new Date().toISOString(),
    agent_id: input.agentId ?? null,
    thread_id: input.threadId ?? null,
    turn_id: input.turnId ?? null,
    metadata: input.metadata,
  };
}

export function createApprovalResult(input: {
  approvalId: string;
  decision: ApprovalDecision;
  reason?: string | null;
  metadata?: JsonObject;
}): ApprovalResult {
  return {
    approval_id: input.approvalId,
    decision: input.decision,
    reason: input.reason ?? null,
    resolved_at: new Date().toISOString(),
    metadata: input.metadata,
  };
}

export function createApprovalRequestedEvent(
  approval: ApprovalRequest,
): ApprovalRequestedEvent {
  return createRuntimeEvent({
    type: "approval.requested",
    approval,
    agent_id: approval.agent_id ?? null,
    thread_id: approval.thread_id ?? null,
    turn_id: approval.turn_id ?? null,
  }) as ApprovalRequestedEvent;
}

export function createApprovalResolvedEvent(
  approval: ApprovalRequest,
  result: ApprovalResult,
): ApprovalResolvedEvent {
  return createRuntimeEvent({
    type:
      result.decision === "rejected"
        ? "approval.rejected"
        : "approval.resolved",
    approval,
    result,
    agent_id: approval.agent_id ?? null,
    thread_id: approval.thread_id ?? null,
    turn_id: approval.turn_id ?? null,
  }) as ApprovalResolvedEvent;
}
