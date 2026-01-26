import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { executeTool, assertSuccess, assertError } from "@test/helpers";
import type { WebSearchOutput } from "@/tools/web-search";

// Mock parallel-web module
const mockSearch = vi.fn();

vi.mock("parallel-web", () => ({
  default: class MockParallel {
    beta = {
      search: mockSearch,
    };
  },
}));

// Import after mocking
import { createWebSearchTool } from "@/tools/web-search";

describe("WebSearch Tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue({
      results: [
        {
          title: "Example Result",
          url: "https://example.com/page",
          excerpts: ["This is a test excerpt"],
          publish_date: "2024-01-15",
        },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("basic search", () => {
    it("should execute a search query", async () => {
      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      const result = await executeTool(tool, {
        query: "test query",
      });

      assertSuccess<WebSearchOutput>(result);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe("Example Result");
      expect(result.results[0].url).toBe("https://example.com/page");
      expect(result.query).toBe("test query");
    });

    it("should pass query to parallel-web", async () => {
      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      await executeTool(tool, {
        query: "my search query",
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          objective: "my search query",
          mode: "agentic",
          max_results: 10,
        }),
      );
    });

    it("should include snippet from excerpts", async () => {
      mockSearch.mockResolvedValue({
        results: [
          {
            title: "Test",
            url: "https://test.com",
            excerpts: ["First excerpt", "Second excerpt"],
          },
        ],
      });

      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      const result = await executeTool(tool, {
        query: "test",
      });

      assertSuccess<WebSearchOutput>(result);
      expect(result.results[0].snippet).toBe("First excerpt\nSecond excerpt");
    });

    it("should include metadata with publish_date", async () => {
      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      const result = await executeTool(tool, {
        query: "test",
      });

      assertSuccess<WebSearchOutput>(result);
      expect(result.results[0].metadata).toEqual({
        publish_date: "2024-01-15",
      });
    });

    it("should return total_results count", async () => {
      mockSearch.mockResolvedValue({
        results: [
          { title: "A", url: "https://a.com", excerpts: [] },
          { title: "B", url: "https://b.com", excerpts: [] },
          { title: "C", url: "https://c.com", excerpts: [] },
        ],
      });

      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      const result = await executeTool(tool, {
        query: "test",
      });

      assertSuccess<WebSearchOutput>(result);
      expect(result.total_results).toBe(3);
    });
  });

  describe("domain filtering", () => {
    it("should pass allowed_domains to source_policy", async () => {
      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      await executeTool(tool, {
        query: "test",
        allowed_domains: ["example.com", "test.com"],
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          source_policy: {
            include_domains: ["example.com", "test.com"],
          },
        }),
      );
    });

    it("should pass blocked_domains to source_policy", async () => {
      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      await executeTool(tool, {
        query: "test",
        blocked_domains: ["spam.com", "ads.com"],
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          source_policy: {
            exclude_domains: ["spam.com", "ads.com"],
          },
        }),
      );
    });

    it("should pass both allowed and blocked domains", async () => {
      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      await executeTool(tool, {
        query: "test",
        allowed_domains: ["good.com"],
        blocked_domains: ["bad.com"],
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          source_policy: {
            include_domains: ["good.com"],
            exclude_domains: ["bad.com"],
          },
        }),
      );
    });

    it("should not include source_policy when no domain filters", async () => {
      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      await executeTool(tool, {
        query: "test",
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.not.objectContaining({
          source_policy: expect.anything(),
        }),
      );
    });
  });

  describe("error handling", () => {
    it("should return error when API fails", async () => {
      mockSearch.mockRejectedValue(new Error("API request failed"));

      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      const result = await executeTool(tool, {
        query: "test",
      });

      assertError(result);
      expect(result.error).toBe("API request failed");
    });

    it("should handle status errors with status code", async () => {
      mockSearch.mockRejectedValue({
        status: 429,
        message: "Rate limit exceeded",
      });

      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      const result = await executeTool(tool, {
        query: "test",
      });

      assertError(result);
      expect(result.error).toBe("Rate limit exceeded");
      expect(result.status_code).toBe(429);
      expect(result.retryable).toBe(true);
    });

    it("should mark 500 errors as retryable", async () => {
      mockSearch.mockRejectedValue({
        status: 500,
        message: "Internal server error",
      });

      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      const result = await executeTool(tool, {
        query: "test",
      });

      assertError(result);
      expect(result.retryable).toBe(true);
    });

    it("should mark 400 errors as non-retryable", async () => {
      mockSearch.mockRejectedValue({
        status: 400,
        message: "Bad request",
      });

      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      const result = await executeTool(tool, {
        query: "test",
      });

      assertError(result);
      expect(result.retryable).toBe(false);
    });
  });

  describe("empty results", () => {
    it("should handle empty results array", async () => {
      mockSearch.mockResolvedValue({
        results: [],
      });

      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      const result = await executeTool(tool, {
        query: "nonexistent query",
      });

      assertSuccess<WebSearchOutput>(result);
      expect(result.results).toEqual([]);
      expect(result.total_results).toBe(0);
    });

    it("should handle undefined results", async () => {
      mockSearch.mockResolvedValue({});

      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      const result = await executeTool(tool, {
        query: "test",
      });

      assertSuccess<WebSearchOutput>(result);
      expect(result.results).toEqual([]);
      expect(result.total_results).toBe(0);
    });
  });

  describe("result transformation", () => {
    it("should handle missing optional fields", async () => {
      mockSearch.mockResolvedValue({
        results: [
          {
            title: undefined,
            url: undefined,
            excerpts: undefined,
          },
        ],
      });

      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      const result = await executeTool(tool, {
        query: "test",
      });

      assertSuccess<WebSearchOutput>(result);
      expect(result.results[0].title).toBe("");
      expect(result.results[0].url).toBe("");
      expect(result.results[0].snippet).toBe("");
    });

    it("should not include metadata when no publish_date", async () => {
      mockSearch.mockResolvedValue({
        results: [
          {
            title: "Test",
            url: "https://test.com",
            excerpts: ["test"],
          },
        ],
      });

      const tool = createWebSearchTool({
        apiKey: "test-api-key",
      });

      const result = await executeTool(tool, {
        query: "test",
      });

      assertSuccess<WebSearchOutput>(result);
      expect(result.results[0].metadata).toBeUndefined();
    });
  });
});
