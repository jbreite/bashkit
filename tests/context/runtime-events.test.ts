import { describe, expect, it } from "vitest";
import { tool, zodSchema } from "ai";
import { z } from "zod";
import { applyContextLayers, createRuntimeEventLayer } from "@/context";
import { createMemoryRuntimeEventSink } from "@/runtime";
import { createAgentTools } from "@/tools";
import { createMockSandbox, executeTool } from "@test/helpers";

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
});
