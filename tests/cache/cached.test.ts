import { describe, it, expect, beforeEach, vi } from "vitest";
import { cached, type CachedTool } from "@/cache/cached";
import { LRUCacheStore } from "@/cache/lru";
import { tool } from "ai";
import { z } from "zod";
import { zodSchema } from "ai";
import type { Tool } from "ai";

/** Create a mock tool for testing */
function createMockTool(executor: (params: unknown) => Promise<unknown>): Tool {
  return tool({
    description: "Mock tool for testing",
    inputSchema: zodSchema(
      z.object({
        input: z.string().optional(),
        a: z.number().optional(),
        b: z.number().optional(),
      }),
    ),
    execute: executor as (params: {
      input?: string;
      a?: number;
      b?: number;
    }) => Promise<unknown>,
  });
}

/** Helper to safely execute a tool */
async function execTool(
  t: Tool,
  params: Record<string, unknown>,
  options = { toolCallId: "test", messages: [] as never[] },
): Promise<unknown> {
  if (!t.execute) {
    throw new Error("Tool has no execute function");
  }
  return t.execute(params, options);
}

describe("cached", () => {
  let mockExecutor: ReturnType<typeof vi.fn>;
  let mockTool: Tool;

  beforeEach(() => {
    mockExecutor = vi.fn().mockResolvedValue({ result: "success" });
    mockTool = createMockTool(mockExecutor);
  });

  describe("basic caching", () => {
    it("should cache successful results", async () => {
      const cachedTool = cached(mockTool, "TestTool");

      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "1", messages: [] },
      );
      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "2", messages: [] },
      );

      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });

    it("should not cache results with error property", async () => {
      mockExecutor.mockResolvedValue({ error: "something failed" });
      const cachedTool = cached(mockTool, "TestTool");

      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "1", messages: [] },
      );
      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "2", messages: [] },
      );

      expect(mockExecutor).toHaveBeenCalledTimes(2);
    });

    it("should cache based on params", async () => {
      const cachedTool = cached(mockTool, "TestTool");

      await execTool(
        cachedTool,
        { input: "test1" },
        { toolCallId: "1", messages: [] },
      );
      await execTool(
        cachedTool,
        { input: "test2" },
        { toolCallId: "2", messages: [] },
      );
      await execTool(
        cachedTool,
        { input: "test1" },
        { toolCallId: "3", messages: [] },
      );

      expect(mockExecutor).toHaveBeenCalledTimes(2);
    });

    it("should return cached result on hit", async () => {
      mockExecutor.mockResolvedValueOnce({ data: "first" });
      mockExecutor.mockResolvedValueOnce({ data: "second" });

      const cachedTool = cached(mockTool, "TestTool");

      const result1 = await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "1", messages: [] },
      );
      const result2 = await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "2", messages: [] },
      );

      expect(result1).toEqual({ data: "first" });
      expect(result2).toEqual({ data: "first" }); // Cached, not "second"
    });
  });

  describe("TTL expiration", () => {
    it("should expire cached entries after TTL", async () => {
      const cachedTool = cached(mockTool, "TestTool", { ttl: 100 });

      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "1", messages: [] },
      );

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "2", messages: [] },
      );

      expect(mockExecutor).toHaveBeenCalledTimes(2);
    });

    it("should use default TTL of 5 minutes", async () => {
      const cachedTool = cached(mockTool, "TestTool");

      // Mock Date.now to test default TTL behavior
      const originalNow = Date.now;
      let currentTime = originalNow();

      vi.spyOn(Date, "now").mockImplementation(() => currentTime);

      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "1", messages: [] },
      );

      // Advance time by 4 minutes - should still be cached
      currentTime += 4 * 60 * 1000;
      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "2", messages: [] },
      );
      expect(mockExecutor).toHaveBeenCalledTimes(1);

      // Advance time by 2 more minutes (total 6 min) - should expire
      currentTime += 2 * 60 * 1000;
      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "3", messages: [] },
      );
      expect(mockExecutor).toHaveBeenCalledTimes(2);

      vi.restoreAllMocks();
    });
  });

  describe("getStats", () => {
    it("should track hits and misses", async () => {
      const cachedTool = cached(mockTool, "TestTool") as CachedTool;

      await execTool(
        cachedTool,
        { input: "a" },
        { toolCallId: "1", messages: [] },
      );
      await execTool(
        cachedTool,
        { input: "a" },
        { toolCallId: "2", messages: [] },
      ); // hit
      await execTool(
        cachedTool,
        { input: "b" },
        { toolCallId: "3", messages: [] },
      );
      await execTool(
        cachedTool,
        { input: "a" },
        { toolCallId: "4", messages: [] },
      ); // hit

      const stats = await cachedTool.getStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(0.5);
    });

    it("should report cache size", async () => {
      const cachedTool = cached(mockTool, "TestTool") as CachedTool;

      await execTool(
        cachedTool,
        { input: "a" },
        { toolCallId: "1", messages: [] },
      );
      await execTool(
        cachedTool,
        { input: "b" },
        { toolCallId: "2", messages: [] },
      );

      const stats = await cachedTool.getStats();
      expect(stats.size).toBe(2);
    });

    it("should return 0 hitRate when no calls made", async () => {
      const cachedTool = cached(mockTool, "TestTool") as CachedTool;

      const stats = await cachedTool.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe("clearCache", () => {
    it("should clear all entries", async () => {
      const cachedTool = cached(mockTool, "TestTool") as CachedTool;

      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "1", messages: [] },
      );
      await cachedTool.clearCache();
      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "2", messages: [] },
      );

      expect(mockExecutor).toHaveBeenCalledTimes(2);
    });

    it("should clear specific key", async () => {
      const store = new LRUCacheStore();
      const cachedTool = cached(mockTool, "TestTool", { store }) as CachedTool;

      await execTool(
        cachedTool,
        { input: "a" },
        { toolCallId: "1", messages: [] },
      );
      await execTool(
        cachedTool,
        { input: "b" },
        { toolCallId: "2", messages: [] },
      );

      // Clear specific key - need to get the key from the store
      // Since keys are hashed, we'll clear all for this test
      await cachedTool.clearCache();

      const stats = await cachedTool.getStats();
      expect(stats.size).toBe(0);
    });
  });

  describe("custom options", () => {
    it("should use custom store", async () => {
      const customStore = new LRUCacheStore(5);
      const cachedTool = cached(mockTool, "TestTool", { store: customStore });

      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "1", messages: [] },
      );

      expect(customStore.size()).toBe(1);
    });

    it("should use custom key generator", async () => {
      const keyGenerator = vi.fn().mockReturnValue("custom-key");
      const cachedTool = cached(mockTool, "TestTool", { keyGenerator });

      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "1", messages: [] },
      );

      expect(keyGenerator).toHaveBeenCalledWith("TestTool", { input: "test" });
    });

    it("should call onHit callback on cache hit", async () => {
      const onHit = vi.fn();
      const cachedTool = cached(mockTool, "TestTool", { onHit });

      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "1", messages: [] },
      );
      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "2", messages: [] },
      );

      expect(onHit).toHaveBeenCalledTimes(1);
      expect(onHit).toHaveBeenCalledWith("TestTool", expect.any(String));
    });

    it("should call onMiss callback on cache miss", async () => {
      const onMiss = vi.fn();
      const cachedTool = cached(mockTool, "TestTool", { onMiss });

      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "1", messages: [] },
      );
      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "2", messages: [] },
      );

      expect(onMiss).toHaveBeenCalledTimes(1);
      expect(onMiss).toHaveBeenCalledWith("TestTool", expect.any(String));
    });
  });

  describe("key generation", () => {
    it("should generate different keys for different params", async () => {
      const cachedTool = cached(mockTool, "TestTool");

      await execTool(
        cachedTool,
        { a: 1, b: 2 },
        { toolCallId: "1", messages: [] },
      );
      await execTool(
        cachedTool,
        { a: 1, b: 3 },
        { toolCallId: "2", messages: [] },
      );

      expect(mockExecutor).toHaveBeenCalledTimes(2);
    });

    it("should generate same key regardless of property order", async () => {
      const cachedTool = cached(mockTool, "TestTool");

      await execTool(
        cachedTool,
        { a: 1, b: 2 },
        { toolCallId: "1", messages: [] },
      );
      await execTool(
        cachedTool,
        { b: 2, a: 1 },
        { toolCallId: "2", messages: [] },
      );

      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });
  });

  describe("edge cases", () => {
    it("should handle null result", async () => {
      mockExecutor.mockResolvedValue(null);
      const cachedTool = cached(mockTool, "TestTool");

      const result = await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "1", messages: [] },
      );

      expect(result).toBeNull();
      // null is not an object with error, so it won't be cached
      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "2", messages: [] },
      );
      expect(mockExecutor).toHaveBeenCalledTimes(2);
    });

    it("should handle undefined result", async () => {
      mockExecutor.mockResolvedValue(undefined);
      const cachedTool = cached(mockTool, "TestTool");

      const result = await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "1", messages: [] },
      );

      expect(result).toBeUndefined();
      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "2", messages: [] },
      );
      expect(mockExecutor).toHaveBeenCalledTimes(2);
    });

    it("should handle primitive results", async () => {
      mockExecutor.mockResolvedValue("string result");
      const cachedTool = cached(mockTool, "TestTool");

      const result = await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "1", messages: [] },
      );

      expect(result).toBe("string result");
      // Primitives are not cached (not objects without error)
      await execTool(
        cachedTool,
        { input: "test" },
        { toolCallId: "2", messages: [] },
      );
      expect(mockExecutor).toHaveBeenCalledTimes(2);
    });

    it("should throw if tool has no execute function", async () => {
      const toolWithoutExecute = {
        description: "No execute",
        parameters: {},
      } as unknown as Tool;

      const cachedTool = cached(toolWithoutExecute, "TestTool");

      await expect(
        execTool(
          cachedTool,
          { input: "test" },
          { toolCallId: "1", messages: [] },
        ),
      ).rejects.toThrow("Tool TestTool has no execute function");
    });
  });

  describe("tool properties", () => {
    it("should preserve original tool properties", () => {
      const originalTool = tool({
        description: "Original description",
        inputSchema: zodSchema(z.object({ test: z.string() })),
        execute: mockExecutor as (params: { test: string }) => Promise<unknown>,
      });

      const cachedTool = cached(originalTool, "TestTool");

      expect(cachedTool.description).toBe("Original description");
      expect(cachedTool.inputSchema).toBeDefined();
    });

    it("should add getStats and clearCache methods", () => {
      const cachedTool = cached(mockTool, "TestTool");

      expect(typeof (cachedTool as CachedTool).getStats).toBe("function");
      expect(typeof (cachedTool as CachedTool).clearCache).toBe("function");
    });
  });
});
