import { createSubagentId } from "./identity";
import type { JsonObject, SubagentId, SubagentMailboxMessage } from "./types";

export function createMailboxMessage(options: {
  agentId: SubagentId;
  message: string;
  kind: "message" | "followup";
  triggerTurn: boolean;
  metadata?: JsonObject;
}): SubagentMailboxMessage {
  return {
    id: createSubagentId("message"),
    agent_id: options.agentId,
    message: options.message,
    kind: options.kind,
    trigger_turn: options.triggerTurn,
    created_at: new Date().toISOString(),
    metadata: options.metadata,
  };
}
