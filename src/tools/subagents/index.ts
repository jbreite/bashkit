import type { ToolSet } from "ai";
import type { SubagentController } from "../../subagents";
import { createFollowupTaskTool } from "./followup-task";
import { createInterruptAgentTool } from "./interrupt-agent";
import { createListAgentsTool } from "./list-agents";
import { createSendMessageTool } from "./send-message";
import { createSpawnAgentTool } from "./spawn-agent";
import { createWaitAgentTool } from "./wait-agent";
import type { SubagentControlToolConfig } from "./types";

export function createSubagentControlTools(
  controller: SubagentController,
  config?: SubagentControlToolConfig,
): ToolSet {
  return {
    SpawnAgent: createSpawnAgentTool(controller, config),
    ListAgents: createListAgentsTool(controller),
    SendMessage: createSendMessageTool(controller),
    FollowupTask: createFollowupTaskTool(controller, config),
    WaitAgent: createWaitAgentTool(controller),
    InterruptAgent: createInterruptAgentTool(controller),
  };
}

export { createSpawnAgentTool } from "./spawn-agent";
export { createListAgentsTool } from "./list-agents";
export { createSendMessageTool } from "./send-message";
export { createFollowupTaskTool } from "./followup-task";
export { createWaitAgentTool } from "./wait-agent";
export { createInterruptAgentTool } from "./interrupt-agent";
export type {
  CompactSubagentRecord,
  InterruptAgentOutput,
  ListAgentsOutput,
  MessageAgentOutput,
  SpawnAgentOutput,
  SubagentControlToolConfig,
  SubagentToolError,
  WaitAgentOutput,
} from "./types";
