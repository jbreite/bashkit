import type { SubagentId } from "./types";

let nextSubagentId = 1;

export function createSubagentId(prefix = "agent"): SubagentId {
  const id = `${prefix}_${nextSubagentId.toString(36)}`;
  nextSubagentId++;
  return id;
}

export function resetSubagentIdCounterForTests(): void {
  nextSubagentId = 1;
}
