import { describe, expect, it } from "vitest";
import { createInMemorySubagentStore } from "@/subagents";
import type { SubagentMetadata } from "@/subagents";

function metadata(): SubagentMetadata {
  return {
    agent_id: "agent_1",
    task_name: "research/auth",
    profile: "worker",
    nickname: "worker",
    model: { id: null },
    status: "pending",
    parent_id: null,
    depth: 0,
    last_task_message: "Research auth",
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T00:00:00.000Z",
  };
}

describe("createInMemorySubagentStore", () => {
  it("stores metadata, mailbox, events, and terminal results", async () => {
    const store = createInMemorySubagentStore();
    await store.create(metadata());
    await store.appendMessage({
      id: "message_1",
      agent_id: "agent_1",
      message: "hello",
      kind: "message",
      trigger_turn: false,
      created_at: "2026-06-15T00:00:00.000Z",
    });
    await store.appendEvent({
      type: "subagent.created",
      agent_id: "agent_1",
      task_name: "research/auth",
      parent_id: null,
      profile: "worker",
      status: "pending",
      timestamp: "2026-06-15T00:00:00.000Z",
    });
    await store.complete(
      { agent_id: "agent_1", task_name: "research/auth" },
      {
        agent_id: "agent_1",
        task_name: "research/auth",
        status: "completed",
        result: "done",
      },
    );

    const record = await store.get({
      agent_id: "agent_1",
      task_name: "research/auth",
    });
    expect(record?.metadata.status).toBe("completed");
    expect(record?.mailbox).toHaveLength(1);
    expect(record?.events).toHaveLength(1);
    expect(record?.result?.result).toBe("done");
  });
});
