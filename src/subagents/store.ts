import type {
  SubagentError,
  SubagentEvent,
  SubagentHandle,
  SubagentListFilter,
  SubagentMailboxMessage,
  SubagentMetadata,
  SubagentMetadataPatch,
  SubagentRecord,
  SubagentRunResult,
  SubagentStore,
} from "./types";
import { isTerminalSubagentStatus } from "./status";

function cloneRecord(record: SubagentRecord): SubagentRecord {
  return {
    metadata: { ...record.metadata, metadata: record.metadata.metadata },
    result: record.result ? { ...record.result } : undefined,
    events: record.events.map((event) => ({ ...event })),
    mailbox: record.mailbox.map((message) => ({ ...message })),
  };
}

export function createInMemorySubagentStore(): SubagentStore {
  const records = new Map<string, SubagentRecord>();

  return {
    async create(metadata: SubagentMetadata): Promise<void> {
      records.set(metadata.agent_id, {
        metadata,
        events: [],
        mailbox: [],
      });
    },

    async update(
      handle: SubagentHandle,
      patch: SubagentMetadataPatch,
    ): Promise<SubagentMetadata | SubagentError> {
      const record = records.get(handle.agent_id);
      if (!record) return { error: `Unknown subagent: ${handle.agent_id}` };

      record.metadata = {
        ...record.metadata,
        ...patch,
        metadata: patch.metadata ?? record.metadata.metadata,
        updated_at: new Date().toISOString(),
      };
      return record.metadata;
    },

    async appendEvent(event: SubagentEvent): Promise<void> {
      const record = records.get(event.agent_id);
      if (record) record.events.push(event);
    },

    async appendMessage(message: SubagentMailboxMessage): Promise<void> {
      const record = records.get(message.agent_id);
      if (record) record.mailbox.push(message);
    },

    async complete(
      handle: SubagentHandle,
      result: SubagentRunResult,
    ): Promise<SubagentMetadata | SubagentError> {
      const record = records.get(handle.agent_id);
      if (!record) return { error: `Unknown subagent: ${handle.agent_id}` };
      record.result = result;
      record.metadata = {
        ...record.metadata,
        status: result.status,
        usage: result.usage ?? record.metadata.usage,
        result_ref: result.result_ref ?? record.metadata.result_ref,
        transcript_ref: result.transcript_ref ?? record.metadata.transcript_ref,
        updated_at: new Date().toISOString(),
      };
      return record.metadata;
    },

    async get(handle: SubagentHandle): Promise<SubagentRecord | null> {
      const record = records.get(handle.agent_id);
      return record ? cloneRecord(record) : null;
    },

    async list(filter: SubagentListFilter = {}): Promise<SubagentRecord[]> {
      let filteredRecords = [...records.values()];
      if (filter.status) {
        filteredRecords = filteredRecords.filter(
          (record) => record.metadata.status === filter.status,
        );
      }
      if (filter.pathPrefix) {
        const pathPrefix = filter.pathPrefix;
        filteredRecords = filteredRecords.filter((record) =>
          record.metadata.task_name?.startsWith(pathPrefix),
        );
      }
      if (filter.includeTerminal === false) {
        filteredRecords = filteredRecords.filter(
          (record) => !isTerminalSubagentStatus(record.metadata.status),
        );
      }
      if (filter.limit != null) {
        filteredRecords = filteredRecords.slice(0, Math.max(0, filter.limit));
      }
      return filteredRecords.map(cloneRecord);
    },
  };
}
