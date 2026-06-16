import type { SubagentError, SubagentPath } from "./types";

export function normalizeSubagentPath(
  path: string | null | undefined,
): SubagentPath | null | SubagentError {
  if (path == null) return null;
  const trimmed = path.trim();
  if (!trimmed) return { error: "task_name cannot be empty" };
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) {
    return {
      error:
        "task_name must be a relative path without leading or trailing slash",
    };
  }

  const parts = trimmed.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (normalized.length === 0) {
        return { error: "task_name cannot escape above the root path" };
      }
      normalized.pop();
      continue;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(part)) {
      return {
        error:
          "task_name segments may only contain letters, numbers, dots, underscores, and dashes",
      };
    }
    normalized.push(part);
  }

  if (normalized.length === 0) return { error: "task_name cannot be empty" };
  return normalized.join("/");
}

export function resolveSubagentPath(
  reference: string,
  options?: { currentPath?: string | null; parentPath?: string | null },
): SubagentPath | SubagentError {
  if (!reference.startsWith("./") && !reference.startsWith("../")) {
    const normalizedReference = normalizeSubagentPath(reference);
    if (normalizedReference == null) {
      return { error: "agent path reference cannot be empty" };
    }
    if (typeof normalizedReference !== "string") return normalizedReference;
    return normalizedReference;
  }

  const base = options?.currentPath ?? options?.parentPath ?? null;
  const baseParts = base ? base.split("/") : [];
  const rawParts = reference.split("/");
  const resolved = [...baseParts];

  for (const part of rawParts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (resolved.length === 0) {
        return {
          error: "agent path reference cannot escape above the root path",
        };
      }
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  const normalized = normalizeSubagentPath(resolved.join("/"));
  if (normalized == null)
    return { error: "agent path reference cannot be empty" };
  return normalized;
}
