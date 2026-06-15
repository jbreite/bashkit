import { createSubagentId } from "./identity";
import { normalizeSubagentPath } from "./path";
import { isTerminalSubagentStatus } from "./status";
import type {
  SubagentError,
  SubagentHandle,
  SubagentRegistry,
  SubagentMetadata,
  SubagentReservationRequest,
  SubagentStatus,
} from "./types";

export function createSubagentRegistry(): SubagentRegistry {
  const records = new Map<string, SubagentMetadata>();
  const livePaths = new Map<string, string>();

  return {
    reserve(
      request: SubagentReservationRequest,
    ): SubagentMetadata | SubagentError {
      const normalizedPath = normalizeSubagentPath(request.taskName);
      if (normalizedPath && typeof normalizedPath !== "string")
        return normalizedPath;
      if (normalizedPath && livePaths.has(normalizedPath)) {
        return {
          error: `Subagent task_name already exists: ${normalizedPath}`,
        };
      }

      const now = new Date().toISOString();
      const metadata: SubagentMetadata = {
        agent_id: createSubagentId(),
        task_name: normalizedPath,
        profile: request.profile,
        nickname: request.nickname,
        status: "pending",
        parent_id: request.parentId ?? null,
        depth: request.depth,
        last_task_message: request.lastTaskMessage,
        created_at: now,
        updated_at: now,
        metadata: {},
      };

      records.set(metadata.agent_id, metadata);
      if (metadata.task_name)
        livePaths.set(metadata.task_name, metadata.agent_id);
      return metadata;
    },

    get(handleOrRef: SubagentHandle | string): SubagentMetadata | null {
      const id =
        typeof handleOrRef === "string"
          ? (livePaths.get(handleOrRef) ?? handleOrRef)
          : handleOrRef.agent_id;
      return records.get(id) ?? null;
    },

    updateStatus(
      handle: SubagentHandle,
      status: SubagentStatus,
    ): SubagentMetadata | SubagentError {
      const metadata = records.get(handle.agent_id);
      if (!metadata) return { error: `Unknown subagent: ${handle.agent_id}` };

      const updated = {
        ...metadata,
        status,
        updated_at: new Date().toISOString(),
      };
      records.set(handle.agent_id, updated);

      if (updated.task_name && isTerminalSubagentStatus(status)) {
        livePaths.delete(updated.task_name);
      }

      return updated;
    },

    release(handle: SubagentHandle): void {
      const metadata = records.get(handle.agent_id);
      if (metadata?.task_name) livePaths.delete(metadata.task_name);
    },

    list(): SubagentMetadata[] {
      return [...records.values()];
    },
  };
}
