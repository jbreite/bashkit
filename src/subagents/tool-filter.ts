import type { ToolSet } from "ai";

export interface SubagentToolFilter {
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];
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
  const selected: ToolSet = {};

  for (const [toolName, tool] of Object.entries(tools)) {
    if (allowed && !allowed.has(toolName)) continue;
    if (denied.has(toolName)) continue;
    selected[toolName] = tool;
  }

  return selected;
}
