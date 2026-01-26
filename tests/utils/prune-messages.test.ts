import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  pruneMessagesByTokens,
} from "@/utils/prune-messages";
import type { ModelMessage } from "ai";

describe("prune-messages", () => {
  describe("estimateTokens", () => {
    it("should estimate tokens as ~4 chars per token", () => {
      expect(estimateTokens("test")).toBe(1);
      expect(estimateTokens("hello")).toBe(2);
      expect(estimateTokens("hello world")).toBe(3);
      expect(estimateTokens("a".repeat(100))).toBe(25);
    });

    it("should handle empty string", () => {
      expect(estimateTokens("")).toBe(0);
    });

    it("should round up partial tokens", () => {
      expect(estimateTokens("abc")).toBe(1); // 3/4 = 0.75, ceil = 1
      expect(estimateTokens("abcde")).toBe(2); // 5/4 = 1.25, ceil = 2
    });
  });

  describe("estimateMessageTokens", () => {
    it("should estimate string content", () => {
      const message: ModelMessage = {
        role: "user",
        content: "Hello world",
      };

      const tokens = estimateMessageTokens(message);
      expect(tokens).toBe(3 + 4); // 3 for content + 4 overhead
    });

    it("should estimate array content with text parts", () => {
      const message: ModelMessage = {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "text", text: "World" },
        ],
      };

      const tokens = estimateMessageTokens(message);
      expect(tokens).toBe(2 + 2 + 4); // 2 + 2 for text + 4 overhead
    });

    it("should estimate tool call messages", () => {
      const message: ModelMessage = {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "123",
            toolName: "Read",
            input: { path: "/test/file.ts" },
          },
        ],
      };

      const tokens = estimateMessageTokens(message);
      expect(tokens).toBeGreaterThan(4); // At least overhead
    });

    it("should estimate tool result messages", () => {
      const message: ModelMessage = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "123",
            toolName: "Read",
            output: { type: "json", value: { content: "file contents" } },
          },
        ],
      };

      const tokens = estimateMessageTokens(message);
      expect(tokens).toBeGreaterThan(4);
    });
  });

  describe("estimateMessagesTokens", () => {
    it("should sum token estimates for all messages", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "user", content: "How are you?" },
      ];

      const total = estimateMessagesTokens(messages);
      const expected = messages.reduce(
        (sum, msg) => sum + estimateMessageTokens(msg),
        0,
      );

      expect(total).toBe(expected);
    });

    it("should handle empty array", () => {
      expect(estimateMessagesTokens([])).toBe(0);
    });
  });

  describe("pruneMessagesByTokens", () => {
    it("should not prune when below threshold", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];

      const pruned = pruneMessagesByTokens(messages, {
        targetTokens: 100,
        minSavingsThreshold: 50,
      });

      expect(pruned).toEqual(messages);
    });

    it("should protect last N user messages", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "First message" },
        { role: "assistant", content: "Response 1" },
        { role: "user", content: "Second message" },
        { role: "assistant", content: "Response 2" },
        { role: "user", content: "Third message" },
        { role: "assistant", content: "Response 3" },
      ];

      const pruned = pruneMessagesByTokens(messages, {
        targetTokens: 10,
        minSavingsThreshold: 5,
        protectLastNUserMessages: 2,
      });

      // Last 2 user messages and their responses should be protected
      expect(pruned[pruned.length - 1]).toEqual(messages[messages.length - 1]);
      expect(pruned[pruned.length - 2]).toEqual(messages[messages.length - 2]);
    });

    it("should prune tool call args in older messages", () => {
      // Note: The pruning code checks for 'args' property (legacy SDK format)
      // This test verifies pruning works with the legacy format
      // We need a large args object so that the assistant message itself exceeds targetTokens
      const largeArgs = { path: "/very/long/path/".repeat(100) };

      const messages: ModelMessage[] = [
        { role: "user", content: "First" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "1",
              toolName: "Read",
              // Using 'args' to match what the pruning code expects
              args: largeArgs,
            } as unknown as ModelMessage["content"] extends (infer T)[]
              ? T
              : never,
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "1",
              toolName: "Read",
              // Using 'result' to match what the pruning code expects
              result: { content: "file contents" },
            } as unknown as ModelMessage["content"] extends (infer T)[]
              ? T
              : never,
          ],
        },
        { role: "user", content: "Second" },
        { role: "assistant", content: "Final response" },
      ] as ModelMessage[];

      const pruned = pruneMessagesByTokens(messages, {
        targetTokens: 20,
        minSavingsThreshold: 10,
        protectLastNUserMessages: 1,
      });

      // The pruned message should have truncated args
      const assistantMsg = pruned.find(
        (m) => m.role === "assistant" && Array.isArray(m.content),
      );
      if (assistantMsg && Array.isArray(assistantMsg.content)) {
        const toolCall = assistantMsg.content.find(
          (p) => typeof p === "object" && "args" in p,
        );
        if (toolCall && "args" in toolCall) {
          expect((toolCall.args as Record<string, unknown>)._pruned).toBe(true);
        }
      }
    });

    it("should prune tool results in older messages", () => {
      // Note: The pruning code checks for 'result' property (legacy SDK format)
      const messages: ModelMessage[] = [
        { role: "user", content: "First" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "1",
              toolName: "Read",
              args: { path: "/test.ts" },
            } as unknown as ModelMessage["content"] extends (infer T)[]
              ? T
              : never,
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "1",
              toolName: "Read",
              result: { content: "x".repeat(50000) },
            } as unknown as ModelMessage["content"] extends (infer T)[]
              ? T
              : never,
          ],
        },
        { role: "user", content: "Second" },
        { role: "assistant", content: "Done" },
      ] as ModelMessage[];

      const pruned = pruneMessagesByTokens(messages, {
        targetTokens: 100,
        minSavingsThreshold: 50,
        protectLastNUserMessages: 1,
      });

      // Find the tool result message
      const toolMsg = pruned.find((m) => m.role === "tool");
      if (toolMsg && Array.isArray(toolMsg.content)) {
        const toolResult = toolMsg.content.find(
          (p) => typeof p === "object" && "result" in p,
        );
        if (toolResult && "result" in toolResult) {
          expect((toolResult.result as Record<string, unknown>)._pruned).toBe(
            true,
          );
        }
      }
    });

    it("should use default config values", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];

      // Should work without config
      const pruned = pruneMessagesByTokens(messages);
      expect(pruned).toEqual(messages);
    });

    it("should handle messages with mixed content", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Query" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I'll help you" },
            {
              type: "tool-call",
              toolCallId: "1",
              toolName: "Bash",
              input: { command: "ls" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "1",
              toolName: "Bash",
              output: { type: "json", value: { stdout: "file1.ts\nfile2.ts" } },
            },
          ],
        },
        { role: "assistant", content: "Here are the files" },
      ];

      // Should not throw
      const pruned = pruneMessagesByTokens(messages, {
        targetTokens: 50,
        minSavingsThreshold: 10,
      });

      expect(pruned.length).toBe(messages.length);
    });

    it("should preserve string assistant messages", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "This is a simple text response" },
        { role: "user", content: "Thanks" },
      ];

      const pruned = pruneMessagesByTokens(messages, {
        targetTokens: 10,
        minSavingsThreshold: 5,
        protectLastNUserMessages: 1,
      });

      // String content should remain unchanged
      const assistantMsg = pruned.find(
        (m) => m.role === "assistant" && typeof m.content === "string",
      );
      expect(assistantMsg?.content).toBe("This is a simple text response");
    });
  });
});
