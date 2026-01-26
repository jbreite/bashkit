import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { executeTool, assertSuccess, assertError } from "@test/helpers";
import type { WebFetchOutput } from "@/tools/web-fetch";

// Must define mock functions before vi.mock calls (hoisting)
vi.mock("parallel-web", () => {
  const mockExtract = vi.fn();
  return {
    default: class MockParallel {
      beta = {
        extract: mockExtract,
      };
    },
    __mockExtract: mockExtract,
  };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  const mockGenerateText = vi.fn();
  return {
    ...actual,
    generateText: mockGenerateText,
    __mockGenerateText: mockGenerateText,
  };
});

// Import after mocking
import { createWebFetchTool } from "@/tools/web-fetch";

// Get mock references
let mockExtract: ReturnType<typeof vi.fn>;
let mockGenerateText: ReturnType<typeof vi.fn>;

describe("WebFetch Tool", () => {
  // Cast mock model to satisfy LanguageModel type requirements
  const mockModel = {
    modelId: "test-model",
    provider: "test-provider",
  } as Parameters<typeof createWebFetchTool>[0]["model"];

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get fresh mock references (accessing internal mock properties added by vi.mock)
    const parallelWeb = (await import("parallel-web")) as unknown as {
      __mockExtract: ReturnType<typeof vi.fn>;
    };
    const ai = (await import("ai")) as unknown as {
      __mockGenerateText: ReturnType<typeof vi.fn>;
    };
    mockExtract = parallelWeb.__mockExtract;
    mockGenerateText = ai.__mockGenerateText;

    mockExtract.mockResolvedValue({
      results: [
        {
          url: "https://example.com/page",
          full_content: "This is the full content of the page.",
          excerpts: ["Excerpt 1", "Excerpt 2"],
        },
      ],
    });
    mockGenerateText.mockResolvedValue({
      text: "This is the AI response about the content.",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("basic fetch", () => {
    it("should fetch URL and process with AI", async () => {
      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      const result = await executeTool(tool, {
        url: "https://example.com/page",
        prompt: "Summarize this page",
      });

      assertSuccess<WebFetchOutput>(result);
      expect(result.response).toBe(
        "This is the AI response about the content.",
      );
      expect(result.url).toBe("https://example.com/page");
    });

    it("should pass URL to parallel-web extract", async () => {
      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      await executeTool(tool, {
        url: "https://test.com/article",
        prompt: "Summarize",
      });

      expect(mockExtract).toHaveBeenCalledWith({
        urls: ["https://test.com/article"],
        excerpts: true,
        full_content: true,
      });
    });

    it("should pass content and prompt to AI model", async () => {
      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      await executeTool(tool, {
        url: "https://example.com/page",
        prompt: "What is this about?",
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockModel,
          prompt: expect.stringContaining("What is this about?"),
        }),
      );
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("This is the full content"),
        }),
      );
    });

    it("should include final_url in response", async () => {
      mockExtract.mockResolvedValue({
        results: [
          {
            url: "https://example.com/redirected",
            full_content: "Content",
          },
        ],
      });

      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      const result = await executeTool(tool, {
        url: "https://example.com/original",
        prompt: "test",
      });

      assertSuccess<WebFetchOutput>(result);
      expect(result.final_url).toBe("https://example.com/redirected");
    });
  });

  describe("content extraction", () => {
    it("should prefer full_content over excerpts", async () => {
      mockExtract.mockResolvedValue({
        results: [
          {
            full_content: "Full content here",
            excerpts: ["Excerpt 1", "Excerpt 2"],
          },
        ],
      });

      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      await executeTool(tool, {
        url: "https://example.com",
        prompt: "test",
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("Full content here"),
        }),
      );
    });

    it("should fall back to excerpts when no full_content", async () => {
      mockExtract.mockResolvedValue({
        results: [
          {
            excerpts: ["Excerpt 1", "Excerpt 2"],
          },
        ],
      });

      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      await executeTool(tool, {
        url: "https://example.com",
        prompt: "test",
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("Excerpt 1\n\nExcerpt 2"),
        }),
      );
    });

    it("should return error when no content extracted", async () => {
      mockExtract.mockResolvedValue({
        results: [
          {
            full_content: "",
            excerpts: [],
          },
        ],
      });

      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      const result = await executeTool(tool, {
        url: "https://example.com",
        prompt: "test",
      });

      assertError(result);
      expect(result.error).toContain("No content available");
    });
  });

  describe("error handling", () => {
    it("should return error when no results from extract", async () => {
      mockExtract.mockResolvedValue({
        results: [],
      });

      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      const result = await executeTool(tool, {
        url: "https://example.com",
        prompt: "test",
      });

      assertError(result);
      expect(result.error).toContain("No content extracted");
    });

    it("should return error when extract throws", async () => {
      mockExtract.mockRejectedValue(new Error("Network error"));

      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      const result = await executeTool(tool, {
        url: "https://example.com",
        prompt: "test",
      });

      assertError(result);
      expect(result.error).toBe("Network error");
    });

    it("should handle status errors with status code", async () => {
      mockExtract.mockRejectedValue({
        status: 404,
        message: "Page not found",
      });

      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      const result = await executeTool(tool, {
        url: "https://example.com/missing",
        prompt: "test",
      });

      assertError(result);
      expect(result.error).toBe("Page not found");
      expect(result.status_code).toBe(404);
    });

    it("should mark 503 errors as retryable", async () => {
      mockExtract.mockRejectedValue({
        status: 503,
        message: "Service unavailable",
      });

      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      const result = await executeTool(tool, {
        url: "https://example.com",
        prompt: "test",
      });

      assertError(result);
      expect(result.retryable).toBe(true);
    });

    it("should return error when generateText fails", async () => {
      mockGenerateText.mockRejectedValue(new Error("AI model error"));

      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      const result = await executeTool(tool, {
        url: "https://example.com",
        prompt: "test",
      });

      assertError(result);
      expect(result.error).toBe("AI model error");
    });
  });

  describe("prompt handling", () => {
    it("should include URL in prompt to AI", async () => {
      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      await executeTool(tool, {
        url: "https://example.com/article",
        prompt: "Summarize",
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("https://example.com/article"),
        }),
      );
    });

    it("should preserve full prompt", async () => {
      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
      });

      const longPrompt =
        "Please extract the main points and summarize the key findings";

      await executeTool(tool, {
        url: "https://example.com",
        prompt: longPrompt,
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining(longPrompt),
        }),
      );
    });
  });

  describe("SDK options", () => {
    it("should pass needsApproval option", async () => {
      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
        needsApproval: true,
      });

      // Verify tool has needsApproval set
      expect(tool.needsApproval).toBe(true);
    });

    it("should pass strict option", async () => {
      const tool = createWebFetchTool({
        apiKey: "test-api-key",
        model: mockModel,
        strict: true,
      });

      // Verify tool has strict set
      expect(tool.strict).toBe(true);
    });
  });
});
