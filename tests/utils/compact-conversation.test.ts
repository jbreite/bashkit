import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelMessage, LanguageModel } from "ai";

// Mock `ai` module — only generateText is used (by summarizeMessages)
vi.mock("ai", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    generateText: vi
      .fn()
      .mockResolvedValue({ text: "Mock summary of conversation." }),
  };
});

import { generateText } from "ai";
import {
  compactConversation,
  createAutoCompaction,
  createCompactConfig,
  MODEL_CONTEXT_LIMITS,
} from "@/utils/compact-conversation";
import type {
  CompactConversationConfig,
  CompactConversationState,
} from "@/utils/compact-conversation";
import { estimateMessagesTokens } from "@/utils/prune-messages";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock LanguageModel that satisfies the type. */
const mockModel = {
  specificationVersion: "v1",
  provider: "test",
  modelId: "test-model",
  defaultObjectGenerationMode: "json",
  doGenerate: vi.fn(),
  doStream: vi.fn(),
} as unknown as LanguageModel;

/** Generate `n` user/assistant message pairs with sizeable content. */
function makeMessages(n: number): ModelMessage[] {
  const msgs: ModelMessage[] = [];
  for (let i = 0; i < n; i++) {
    msgs.push({
      role: "user",
      content: `User message ${i}: ${"lorem ipsum dolor sit amet ".repeat(40)}`,
    });
    msgs.push({
      role: "assistant",
      content: `Assistant reply ${i}: ${"the quick brown fox ".repeat(40)}`,
    });
  }
  return msgs;
}

/** Build a default config that will compact at a low token count. */
function makeConfig(
  overrides?: Partial<CompactConversationConfig>,
): CompactConversationConfig {
  return {
    maxTokens: 2000,
    summarizerModel: mockModel,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(generateText).mockReset();
  vi.mocked(generateText).mockResolvedValue({
    text: "Mock summary of conversation.",
  } as never);
});

describe("compactConversation", () => {
  it("returns didCompact: false when under threshold", async () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];

    const result = await compactConversation(
      messages,
      makeConfig({ maxTokens: 100_000 }),
    );

    expect(result.didCompact).toBe(false);
    expect(result.messages).toBe(messages); // same reference, untouched
    expect(generateText).not.toHaveBeenCalled();
  });

  it("compacts and returns summary + recent messages when over threshold", async () => {
    const messages = makeMessages(30); // ~30 pairs → well above 2000 tokens
    const config = makeConfig();

    const result = await compactConversation(messages, config);

    expect(result.didCompact).toBe(true);
    expect(generateText).toHaveBeenCalledOnce();

    // First message should be the summary injection
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toContain(
      "[Previous conversation summary]",
    );
    expect(result.messages[0].content).toContain("Mock summary");

    // Second message should be assistant acknowledgment
    expect(result.messages[1].role).toBe("assistant");

    // Total messages should be fewer than original
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  it("respects custom compactionThreshold", async () => {
    const messages = makeMessages(10);
    const tokens = estimateMessagesTokens(messages);

    // Set maxTokens so default 0.85 threshold would NOT trigger, but 0.1 would
    const highMaxTokens = tokens * 2;

    const noCompact = await compactConversation(
      messages,
      makeConfig({ maxTokens: highMaxTokens, compactionThreshold: 0.85 }),
    );
    expect(noCompact.didCompact).toBe(false);

    const yesCompact = await compactConversation(
      messages,
      makeConfig({ maxTokens: highMaxTokens, compactionThreshold: 0.1 }),
    );
    expect(yesCompact.didCompact).toBe(true);
  });

  it("respects protectRecentMessages config", async () => {
    const messages = makeMessages(20);
    const config = makeConfig({ protectRecentMessages: 4 });

    const result = await compactConversation(messages, config);

    expect(result.didCompact).toBe(true);
    // 2 injected (summary + ack) + at least 4 protected
    expect(result.messages.length).toBeGreaterThanOrEqual(6);

    // The last 4 original messages should appear at the end of the result
    const origTail = messages.slice(-4);
    const resultTail = result.messages.slice(-4);
    expect(resultTail).toEqual(origTail);
  });

  it("preserves tool call/result pairs (safe split)", async () => {
    // Build messages where a tool call/result pair sits near the split boundary
    const filler = makeMessages(15);
    const toolPair: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "Read",
            args: { file_path: "/x.ts" },
          },
        ],
      } as unknown as ModelMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "Read",
            result: "contents",
          },
        ],
      } as unknown as ModelMessage,
    ];
    // Place tool pair right before the last 10 messages (default protect count)
    const before = filler.slice(0, -10);
    const after = filler.slice(-10);
    const messages = [...before, ...toolPair, ...after];

    const result = await compactConversation(
      messages,
      makeConfig({ protectRecentMessages: 10 }),
    );

    if (result.didCompact) {
      // The recent portion should not start with a tool result (orphaned)
      const recentStart = result.messages[2]; // after summary + ack
      expect(recentStart.role).not.toBe("tool");
    }
  });

  it("returns didCompact: false when all messages are protected", async () => {
    // Only 4 messages, protect 10 → nothing to summarize
    const messages: ModelMessage[] = [
      { role: "user", content: "a".repeat(10000) },
      { role: "assistant", content: "b".repeat(10000) },
      { role: "user", content: "c".repeat(10000) },
      { role: "assistant", content: "d".repeat(10000) },
    ];

    const result = await compactConversation(
      messages,
      makeConfig({ maxTokens: 500, protectRecentMessages: 10 }),
    );

    expect(result.didCompact).toBe(false);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("updates state.conversationSummary after compaction", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "First summary.",
    } as never);

    const state: CompactConversationState = { conversationSummary: "" };
    const result = await compactConversation(
      makeMessages(30),
      makeConfig(),
      state,
    );

    expect(result.didCompact).toBe(true);
    expect(result.state.conversationSummary).toBe("First summary.");
  });

  it("includes file operations in the summarization prompt", async () => {
    // Build messages with tool calls for Read, Write, and Edit in the old portion,
    // followed by enough plain messages to stay in the "recent" window.
    const toolMessages: ModelMessage[] = [
      { role: "user", content: "Please read and edit some files." },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "r1",
            toolName: "Read",
            args: { file_path: "/src/app.ts" },
          },
        ],
      } as unknown as ModelMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "r1",
            toolName: "Read",
            result: "file contents",
          },
        ],
      } as unknown as ModelMessage,
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "w1",
            toolName: "Write",
            args: { file_path: "/src/new-file.ts" },
          },
        ],
      } as unknown as ModelMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "w1",
            toolName: "Write",
            result: "ok",
          },
        ],
      } as unknown as ModelMessage,
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "e1",
            toolName: "Edit",
            args: { file_path: "/src/utils.ts" },
          },
        ],
      } as unknown as ModelMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "e1",
            toolName: "Edit",
            result: "ok",
          },
        ],
      } as unknown as ModelMessage,
    ];

    // Recent filler that will be protected (not summarized)
    const recentMessages = makeMessages(6); // 12 messages → protected by default 10
    const allMessages = [...toolMessages, ...recentMessages];

    await compactConversation(
      allMessages,
      makeConfig({ protectRecentMessages: 12 }),
    );

    expect(generateText).toHaveBeenCalledOnce();

    const call = vi.mocked(generateText).mock.calls[0][0] as {
      messages: ModelMessage[];
    };
    const prompt = String(call.messages[0].content);

    expect(prompt).toContain("<file-operations>");
    expect(prompt).toContain("/src/app.ts"); // Read
    expect(prompt).toContain("/src/new-file.ts"); // Write (Modified)
    expect(prompt).toContain("/src/utils.ts"); // Edit (Modified)
  });

  it("includes summaryInstructions in the summarization prompt", async () => {
    await compactConversation(
      makeMessages(30),
      makeConfig({ summaryInstructions: "Focus on database schema decisions" }),
    );

    expect(generateText).toHaveBeenCalledOnce();

    const call = vi.mocked(generateText).mock.calls[0][0] as {
      messages: ModelMessage[];
    };
    const prompt = String(call.messages[0].content);
    expect(prompt).toContain("Focus on database schema decisions");
  });

  it("passes previous summary to the summarizer on subsequent compactions", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Second summary.",
    } as never);

    const state: CompactConversationState = {
      conversationSummary: "First summary.",
    };
    const result = await compactConversation(
      makeMessages(30),
      makeConfig(),
      state,
    );

    expect(result.didCompact).toBe(true);

    // Verify the prompt sent to generateText included the previous summary
    const call = vi.mocked(generateText).mock.calls[0][0] as {
      messages: ModelMessage[];
    };
    const promptContent = String(call.messages[0].content);
    expect(promptContent).toContain("First summary.");
  });
});

describe("createAutoCompaction", () => {
  it("returns {} when under threshold (no compaction)", async () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];

    const compaction = createAutoCompaction({
      maxTokens: 100_000,
      summarizerModel: mockModel,
    });

    const result = await compaction.prepareStep({
      messages,
      stepNumber: 1,
      model: mockModel,
    } as never);

    expect(result).toEqual({});
    expect(generateText).not.toHaveBeenCalled();
  });

  it("triggers compaction when tokens exceed threshold", async () => {
    const messages = makeMessages(30);

    const compaction = createAutoCompaction({
      maxTokens: 2000,
      summarizerModel: mockModel,
    });

    const result = await compaction.prepareStep({
      messages,
      stepNumber: 1,
      model: mockModel,
    } as never);

    expect(result).toHaveProperty("messages");
    expect(generateText).toHaveBeenCalledOnce();
    expect(
      (result as { messages: ModelMessage[] }).messages.length,
    ).toBeLessThan(messages.length);
  });

  it("uses custom compactionThreshold", async () => {
    const messages = makeMessages(20);
    const tokens = estimateMessagesTokens(messages);

    // With default 0.85 threshold → won't trigger (tokens < maxTokens * 0.85)
    const highMax = Math.ceil(tokens / 0.8); // tokens ~= 80% of highMax → below 0.85
    const noCompact = createAutoCompaction({
      maxTokens: highMax,
      summarizerModel: mockModel,
    });
    const noResult = await noCompact.prepareStep({
      messages,
      stepNumber: 1,
      model: mockModel,
    } as never);
    expect(noResult).toEqual({});

    // With 0.5 threshold → same maxTokens but now triggers
    const yesCompact = createAutoCompaction({
      maxTokens: highMax,
      summarizerModel: mockModel,
      compactionThreshold: 0.5,
    });
    const yesResult = await yesCompact.prepareStep({
      messages,
      stepNumber: 1,
      model: mockModel,
    } as never);
    expect(yesResult).toHaveProperty("messages");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("updates state.conversationSummary after compaction", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Auto summary.",
    } as never);

    const compaction = createAutoCompaction({
      maxTokens: 2000,
      summarizerModel: mockModel,
    });

    expect(compaction.state.conversationSummary).toBe("");

    await compaction.prepareStep({
      messages: makeMessages(30),
      stepNumber: 1,
      model: mockModel,
    } as never);

    expect(compaction.state.conversationSummary).toBe("Auto summary.");
  });

  it("handles multiple compaction cycles (state accumulates)", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "Summary round 1." } as never)
      .mockResolvedValueOnce({ text: "Summary round 2." } as never);

    const compaction = createAutoCompaction({
      maxTokens: 2000,
      summarizerModel: mockModel,
    });

    // First compaction
    await compaction.prepareStep({
      messages: makeMessages(30),
      stepNumber: 1,
      model: mockModel,
    } as never);

    expect(compaction.state.conversationSummary).toBe("Summary round 1.");

    // Second compaction (fresh large messages)
    await compaction.prepareStep({
      messages: makeMessages(30),
      stepNumber: 2,
      model: mockModel,
    } as never);

    expect(compaction.state.conversationSummary).toBe("Summary round 2.");

    // Second call should have received the first summary in the prompt
    const secondCall = vi.mocked(generateText).mock.calls[1][0] as {
      messages: ModelMessage[];
    };
    const prompt = String(secondCall.messages[0].content);
    expect(prompt).toContain("Summary round 1.");
  });
});

describe("createCompactConfig", () => {
  it("returns config with correct maxTokens for model ID", () => {
    const config = createCompactConfig("claude-sonnet-4-5", mockModel);

    expect(config.maxTokens).toBe(200_000);
    expect(config.summarizerModel).toBe(mockModel);
  });

  it("applies overrides", () => {
    const config = createCompactConfig("gpt-4o", mockModel, {
      compactionThreshold: 0.7,
      protectRecentMessages: 20,
    });

    expect(config.maxTokens).toBe(128_000);
    expect(config.compactionThreshold).toBe(0.7);
    expect(config.protectRecentMessages).toBe(20);
  });

  it("override can replace maxTokens", () => {
    const config = createCompactConfig("gpt-4", mockModel, {
      maxTokens: 50_000,
    });

    expect(config.maxTokens).toBe(50_000);
  });
});
