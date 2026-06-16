import { describe, expect, it } from "vitest";
import { tool, zodSchema } from "ai";
import { z } from "zod";
import { applyContextLayers, createRuntimeEventLayer } from "@/context";
import {
  createMemoryRuntimeEventSink,
  projectChangesSnapshot,
} from "@/runtime";
import { createAgentTools } from "@/tools";
import {
  createMockSandbox,
  executeTool,
  type MockSandbox,
} from "@test/helpers";

describe("createRuntimeEventLayer", () => {
  it("emits tool started and completed events", async () => {
    const sink = createMemoryRuntimeEventSink();
    const tools = applyContextLayers(
      {
        Echo: tool({
          inputSchema: zodSchema(z.object({ value: z.string() })),
          execute: async ({ value }) => ({ value }),
        }),
      },
      [
        createRuntimeEventLayer({
          eventSink: sink,
          agentId: "agent_1",
          turnId: "turn_1",
        }),
      ],
    );

    await executeTool(tools.Echo, { value: "hello" });

    expect(sink.events.map((event) => event.type)).toEqual([
      "tool.started",
      "tool.completed",
    ]);
    expect(sink.events[0]).toMatchObject({
      type: "tool.started",
      tool_name: "Echo",
      agent_id: "agent_1",
      turn_id: "turn_1",
    });
    expect(sink.events[1]).toMatchObject({
      type: "tool.completed",
      tool_name: "Echo",
      output: { value: "hello" },
    });
  });

  it("emits failed events for model-visible error objects", async () => {
    const sink = createMemoryRuntimeEventSink();
    const tools = applyContextLayers(
      {
        Fails: tool({
          inputSchema: zodSchema(z.object({})),
          execute: async () => ({ error: "nope" }),
        }),
      },
      [createRuntimeEventLayer({ eventSink: sink })],
    );

    await executeTool(tools.Fails, {});

    expect(sink.events[1]).toMatchObject({
      type: "tool.failed",
      tool_name: "Fails",
      error: "nope",
    });
  });

  it("createAgentTools wires runtime events without requiring context config", async () => {
    const sink = createMemoryRuntimeEventSink();
    const sandbox = createMockSandbox({ files: { "/tmp/test.txt": "hello" } });
    const { tools } = await createAgentTools(sandbox, {
      runtime: {
        eventSink: sink,
        planContext: { thread_id: "thread_1" },
      },
    });

    await executeTool(tools.Read, {
      file_path: "/tmp/test.txt",
      offset: null,
      limit: null,
    });

    expect(sink.events.map((event) => event.type)).toEqual([
      "tool.started",
      "tool.completed",
    ]);
    expect(sink.events[0]).toMatchObject({
      tool_name: "Read",
      thread_id: "thread_1",
    });
  });

  it("emits file changed events for successful Write calls", async () => {
    const sink = createMemoryRuntimeEventSink();
    const sandbox = createMockSandbox();
    const { tools } = await createAgentTools(sandbox, {
      runtime: {
        eventSink: sink,
        planContext: {
          agent_id: "agent_1",
          thread_id: "thread_1",
          turn_id: "turn_1",
        },
      },
    });

    await executeTool(tools.Write, {
      file_path: "/tmp/new.txt",
      content: "hello\n",
    });

    const started = sink.events.find((event) => event.type === "tool.started");
    const changed = sink.events.find((event) => event.type === "file.changed");

    expect(changed).toMatchObject({
      type: "file.changed",
      path: "/tmp/new.txt",
      change: "created",
      tool_name: "Write",
      agent_id: "agent_1",
      thread_id: "thread_1",
      turn_id: "turn_1",
    });
    expect(changed?.tool_call_id).toBe(started?.tool_call_id);
    expect(changed?.unified_diff).toContain("+hello");
  });

  it("emits modified file changed events for Edit calls", async () => {
    const sink = createMemoryRuntimeEventSink();
    const sandbox = createMockSandbox({
      files: { "/tmp/file.txt": "before\n" },
    });
    const { tools } = await createAgentTools(sandbox, {
      runtime: { eventSink: sink },
    });

    await executeTool(tools.Edit, {
      file_path: "/tmp/file.txt",
      old_string: "before",
      new_string: "after",
      replace_all: null,
    });

    const changed = sink.events.find((event) => event.type === "file.changed");
    expect(changed).toMatchObject({
      type: "file.changed",
      path: "/tmp/file.txt",
      change: "modified",
      tool_name: "Edit",
    });
    expect(changed?.unified_diff).toContain("-before");
    expect(changed?.unified_diff).toContain("+after");
  });

  it("emits deleted file changed events for Patch calls", async () => {
    const sink = createMemoryRuntimeEventSink();
    const sandbox = createMockSandbox({
      files: { "/tmp/delete.txt": "gone\n" },
    });
    const { tools } = await createAgentTools(sandbox, {
      patch: true,
      runtime: { eventSink: sink },
    });

    await executeTool(tools.Patch, {
      patch: `*** Begin Patch
*** Delete File: /tmp/delete.txt
*** End Patch`,
    });

    const changes = projectChangesSnapshot(sink.events);
    expect(changes).toEqual([
      expect.objectContaining({
        path: "/tmp/delete.txt",
        change: "deleted",
        unified_diff: expect.stringContaining("-gone"),
      }),
    ]);
  });

  it("emits file changed events for Bash workspace mutations", async () => {
    const sink = createMemoryRuntimeEventSink();
    let sandbox: MockSandbox;
    sandbox = createMockSandbox({
      files: {
        "/workspace": ["file.txt"],
        "/workspace/file.txt": "before\n",
      },
      execHandler: () => {
        sandbox.setFile("/workspace/file.txt", "after\n");
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: 1,
          interrupted: false,
        };
      },
    });
    const { tools } = await createAgentTools(sandbox, {
      runtime: {
        eventSink: sink,
        fileChanges: { rootPaths: ["/workspace"] },
      },
    });

    await executeTool(tools.Bash, {
      command: "printf after > /workspace/file.txt",
      timeout: null,
      description: null,
      run_in_background: null,
    });

    const changed = sink.events.find((event) => event.type === "file.changed");
    expect(changed).toMatchObject({
      type: "file.changed",
      path: "/workspace/file.txt",
      change: "modified",
      tool_name: "Bash",
    });
    expect(changed?.unified_diff).toContain("-before");
    expect(changed?.unified_diff).toContain("+after");
  });

  it("does not emit file changed events for failed mutating calls", async () => {
    const sink = createMemoryRuntimeEventSink();
    const sandbox = createMockSandbox();
    const { tools } = await createAgentTools(sandbox, {
      runtime: { eventSink: sink },
    });

    await executeTool(tools.Edit, {
      file_path: "/tmp/missing.txt",
      old_string: "before",
      new_string: "after",
      replace_all: null,
    });

    expect(sink.events.some((event) => event.type === "file.changed")).toBe(
      false,
    );
  });

  it("can disable automatic file changed events", async () => {
    const sink = createMemoryRuntimeEventSink();
    const sandbox = createMockSandbox();
    const { tools } = await createAgentTools(sandbox, {
      runtime: {
        eventSink: sink,
        fileChanges: false,
      },
    });

    await executeTool(tools.Write, {
      file_path: "/tmp/new.txt",
      content: "hello\n",
    });

    expect(sink.events.map((event) => event.type)).toEqual([
      "tool.started",
      "tool.completed",
    ]);
  });
});
