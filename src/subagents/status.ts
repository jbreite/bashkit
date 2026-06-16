import type { SubagentStatus } from "./types";

const TERMINAL_STATUSES = new Set<SubagentStatus>([
  "completed",
  "failed",
  "interrupted",
]);

export function isTerminalSubagentStatus(status: SubagentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isActiveSubagentStatus(status: SubagentStatus): boolean {
  return status === "pending" || status === "running" || status === "waiting";
}
