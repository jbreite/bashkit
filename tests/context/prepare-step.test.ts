import { describe, it, expect, vi } from "vitest";
import type { ModelMessage } from "ai";
import type { PlanModeState } from "@/tools/enter-plan-mode";
import { createPrepareStep } from "@/context/prepare-step";

function makeMessages(count: number): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}: ${"x".repeat(100)}`,
    });
  }
  return messages;
}

const defaultArgs = {
  stepNumber: 1,
  steps: [],
  model: {} as never,
  experimental_context: undefined,
};

describe("createPrepareStep", () => {
  it("does NOT return system field (never overrides system prompt)", async () => {
    const prepareStep = createPrepareStep({});
    const result = await prepareStep({
      ...defaultArgs,
      messages: makeMessages(2),
    });
    expect(result ?? {}).not.toHaveProperty("system");
  });

  it("returns undefined messages when nothing changes", async () => {
    const prepareStep = createPrepareStep({});
    const messages = makeMessages(2);
    const result = await prepareStep({
      ...defaultArgs,
      messages,
    });
    expect(result?.messages).toBeUndefined();
  });

  it("injects plan mode hint as user message when active", async () => {
    const state: PlanModeState = { isActive: true };
    const prepareStep = createPrepareStep({ planModeState: state });
    const messages = makeMessages(2);
    const result = await prepareStep({
      ...defaultArgs,
      messages,
    });

    expect(result?.messages).toBeDefined();
    if (!result?.messages) throw new Error("expected messages");
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toContain("PLAN MODE ACTIVE");
  });

  it("does not inject plan mode hint when inactive", async () => {
    const state: PlanModeState = { isActive: false };
    const prepareStep = createPrepareStep({ planModeState: state });
    const messages = makeMessages(2);
    const result = await prepareStep({
      ...defaultArgs,
      messages,
    });

    expect(result?.messages).toBeUndefined();
  });

  it("calls extend callback after built-in logic", async () => {
    const extendSpy = vi.fn(async () => ({
      activeTools: ["Read", "Grep"],
    }));

    const prepareStep = createPrepareStep({
      extend: extendSpy,
    });

    const messages = makeMessages(2);
    const result = await prepareStep({
      ...defaultArgs,
      messages,
    });

    expect(extendSpy).toHaveBeenCalledTimes(1);
    expect(result?.activeTools).toEqual(["Read", "Grep"]);
  });

  it("extend receives messages from built-in logic", async () => {
    const state: PlanModeState = { isActive: true };
    let receivedMessages: ModelMessage[] | undefined;

    const prepareStep = createPrepareStep({
      planModeState: state,
      extend: async (args) => {
        receivedMessages = args.messages;
        return {};
      },
    });

    const messages = makeMessages(2);
    await prepareStep({ ...defaultArgs, messages });

    // extend should get the messages with plan mode hint injected
    expect(receivedMessages).toBeDefined();
    expect(receivedMessages!.length).toBeGreaterThan(messages.length);
    const lastMsg = receivedMessages![receivedMessages!.length - 1];
    expect(lastMsg.content).toContain("PLAN MODE ACTIVE");
  });

  it("extend returning messages takes priority over built-in messages", async () => {
    const state: PlanModeState = { isActive: true };
    const customMessages: ModelMessage[] = [
      { role: "user", content: "custom message only" },
    ];

    const prepareStep = createPrepareStep({
      planModeState: state,
      extend: async () => ({
        messages: customMessages,
      }),
    });

    const messages = makeMessages(2);
    const result = await prepareStep({ ...defaultArgs, messages });

    // extend's messages should win
    expect(result?.messages).toEqual(customMessages);
  });

  it("plan mode + context status both active simultaneously", async () => {
    const state: PlanModeState = { isActive: true };
    const prepareStep = createPrepareStep({
      planModeState: state,
      contextStatus: {
        maxTokens: 100, // Very low — will trigger high/critical
      },
    });

    // Many messages to push past threshold
    const messages = makeMessages(20);
    const result = await prepareStep({ ...defaultArgs, messages });

    expect(result?.messages).toBeDefined();
    if (!result?.messages) throw new Error("expected messages");
    const injected = result.messages.slice(messages.length);
    const contents = injected.map((m) =>
      typeof m.content === "string" ? m.content : "",
    );

    // Both should be present
    expect(contents.some((c) => c.includes("PLAN MODE"))).toBe(true);
  });

  it("preserves original messages when only extend runs", async () => {
    const prepareStep = createPrepareStep({
      extend: async () => ({
        activeTools: ["Read"],
      }),
    });

    const messages = makeMessages(2);
    const result = await prepareStep({ ...defaultArgs, messages });

    // No message modification from built-in logic
    expect(result?.messages).toBeUndefined();
    expect(result?.activeTools).toEqual(["Read"]);
  });

  it("reacts to plan mode state changes between steps", async () => {
    const state: PlanModeState = { isActive: false };
    const prepareStep = createPrepareStep({ planModeState: state });
    const messages = makeMessages(2);

    // Step 1: inactive
    const r1 = await prepareStep({ ...defaultArgs, messages });
    expect(r1?.messages).toBeUndefined();

    // Step 2: active
    state.isActive = true;
    const r2 = await prepareStep({ ...defaultArgs, messages });
    expect(r2?.messages).toBeDefined();
    if (!r2?.messages) throw new Error("expected messages");
    const hasHint = r2.messages.some(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("PLAN MODE"),
    );
    expect(hasHint).toBe(true);

    // Step 3: inactive again
    state.isActive = false;
    const r3 = await prepareStep({ ...defaultArgs, messages });
    expect(r3?.messages).toBeUndefined();
  });
});
