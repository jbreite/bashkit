import type { ResolvedSubagentProfile } from "./types";

export function describeSubagentProfile(
  profile: ResolvedSubagentProfile,
): string {
  const parts = [
    `${profile.name}: ${profile.description}`,
    `codemode=${profile.codemode.enabled ? "enabled" : "disabled"}`,
  ];

  if (profile.allowedTools.length > 0) {
    parts.push(`allowed tools: ${profile.allowedTools.join(", ")}`);
  }
  if (profile.deniedTools.length > 0) {
    parts.push(`denied tools: ${profile.deniedTools.join(", ")}`);
  }
  if (profile.cost.maxUsd != null) {
    parts.push(`budget cap: $${profile.cost.maxUsd}`);
  }
  parts.push(`max depth: ${profile.cost.maxDepth}`);

  return parts.join("; ");
}
