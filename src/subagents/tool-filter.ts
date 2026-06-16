import type { Tool, ToolSet } from "ai";
import type { SubagentDeniedToolBehavior } from "./types";

export interface SubagentToolFilter {
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];
  deniedBehavior?: SubagentDeniedToolBehavior;
  profileName?: string;
}

export interface DeniedSubagentToolError {
  error: string;
}

function createDeniedToolError(
  toolName: string,
  profileName: string | undefined,
): DeniedSubagentToolError {
  return {
    error: `Tool ${toolName} is not allowed for subagent profile ${
      profileName ?? "unknown"
    }`,
  };
}

export function createDeniedSubagentTool(
  toolName: string,
  tool: Tool,
  profileName?: string,
): Tool {
  return {
    ...tool,
    execute: async (): Promise<DeniedSubagentToolError> =>
      createDeniedToolError(toolName, profileName),
  };
}

export function filterSubagentTools(
  tools: ToolSet,
  filter: SubagentToolFilter,
): ToolSet {
  const allowed =
    filter.allowedTools && filter.allowedTools.length > 0
      ? new Set(filter.allowedTools)
      : null;
  const denied = new Set(filter.deniedTools ?? []);
  const deniedBehavior = filter.deniedBehavior ?? "reject";
  const selected: ToolSet = {};

  for (const [toolName, tool] of Object.entries(tools)) {
    if (allowed && !allowed.has(toolName)) continue;
    if (denied.has(toolName)) {
      if (deniedBehavior === "hide") continue;
      selected[toolName] = createDeniedSubagentTool(
        toolName,
        tool,
        filter.profileName,
      );
      continue;
    }
    selected[toolName] = tool;
  }

  return selected;
}
