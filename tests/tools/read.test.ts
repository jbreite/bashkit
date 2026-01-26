import { describe, it, expect, beforeEach } from "vitest";
import {
  createReadTool,
  type ReadTextOutput,
  type ReadDirectoryOutput,
} from "@/tools/read";
import {
  createMockSandbox,
  executeTool,
  assertSuccess,
  assertError,
  sampleProjectFiles,
  createLargeFile,
  createBinaryContent,
  type MockSandbox,
} from "@test/helpers";

/** ReadOutput without error type for successful assertions */
type ReadSuccessOutput = ReadTextOutput | ReadDirectoryOutput;

describe("Read Tool", () => {
  let sandbox: MockSandbox;

  beforeEach(() => {
    sandbox = createMockSandbox({
      files: { ...sampleProjectFiles },
    });
  });

  describe("file reading", () => {
    it("should read a file and return content with line numbers", async () => {
      const tool = createReadTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/src/utils.ts",
      });

      assertSuccess<ReadSuccessOutput>(result);
      expect(result.type).toBe("text");
      if (result.type === "text") {
        expect(result.content).toContain("export function greet");
        expect(result.lines).toBeInstanceOf(Array);
        expect(result.lines[0].line_number).toBe(1);
        expect(result.total_lines).toBeGreaterThan(0);
      }
    });

    it("should return error for non-existent file", async () => {
      const tool = createReadTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/missing-file.ts",
      });

      assertError(result);
      expect(result.error).toContain("not found");
    });

    it("should handle empty files", async () => {
      sandbox.setFile("/workspace/empty.ts", "");

      const tool = createReadTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/empty.ts",
      });

      assertSuccess<ReadSuccessOutput>(result);
      expect(result.type).toBe("text");
      if (result.type === "text") {
        expect(result.content).toBe("");
      }
    });
  });

  describe("directory reading", () => {
    it("should list directory contents", async () => {
      const tool = createReadTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/src",
      });

      assertSuccess<ReadSuccessOutput>(result);
      expect(result.type).toBe("directory");
      if (result.type === "directory") {
        expect(result.entries).toContain("index.ts");
        expect(result.entries).toContain("utils.ts");
        expect(result.entries).toContain("types.ts");
        expect(result.count).toBe(3);
      }
    });

    it("should list root directory", async () => {
      const tool = createReadTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace",
      });

      assertSuccess<ReadSuccessOutput>(result);
      expect(result.type).toBe("directory");
      if (result.type === "directory") {
        expect(result.entries).toContain("src");
        expect(result.entries).toContain("package.json");
      }
    });
  });

  describe("pagination", () => {
    it("should read with offset and limit", async () => {
      sandbox.setFile("/workspace/large.ts", createLargeFile(100));

      const tool = createReadTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/large.ts",
        offset: 10,
        limit: 5,
      });

      assertSuccess<ReadSuccessOutput>(result);
      expect(result.type).toBe("text");
      if (result.type === "text") {
        expect(result.lines).toHaveLength(5);
        expect(result.lines[0].line_number).toBe(10);
        expect(result.lines[0].content).toBe("Line 10");
        expect(result.lines[4].line_number).toBe(14);
        expect(result.total_lines).toBe(100);
      }
    });

    it("should require pagination for large files", async () => {
      sandbox.setFile("/workspace/very-large.ts", createLargeFile(1000));

      const tool = createReadTool(sandbox, { maxFileSize: 500 });
      const result = await executeTool(tool, {
        file_path: "/workspace/very-large.ts",
      });

      assertError(result);
      expect(result.error).toContain("File is large");
      expect(result.error).toContain("offset");
      expect(result.error).toContain("limit");
    });

    it("should allow large files with limit specified", async () => {
      sandbox.setFile("/workspace/very-large.ts", createLargeFile(1000));

      const tool = createReadTool(sandbox, { maxFileSize: 500 });
      const result = await executeTool(tool, {
        file_path: "/workspace/very-large.ts",
        limit: 100,
      });

      assertSuccess<ReadSuccessOutput>(result);
      expect(result.type).toBe("text");
      if (result.type === "text") {
        expect(result.lines).toHaveLength(100);
      }
    });

    it("should use default maxFileSize of 500 lines", async () => {
      sandbox.setFile("/workspace/medium.ts", createLargeFile(501));

      const tool = createReadTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/medium.ts",
      });

      assertError(result);
      expect(result.error).toContain("File is large");
    });

    it("should handle offset beyond file length", async () => {
      sandbox.setFile("/workspace/small.ts", createLargeFile(10));

      const tool = createReadTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/small.ts",
        offset: 100,
        limit: 10,
      });

      assertSuccess<ReadSuccessOutput>(result);
      expect(result.type).toBe("text");
      if (result.type === "text") {
        expect(result.lines).toHaveLength(0);
      }
    });
  });

  describe("binary file detection", () => {
    it("should detect binary files and return error", async () => {
      sandbox.setFile("/workspace/image.png", createBinaryContent(1000));

      const tool = createReadTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/image.png",
      });

      assertError(result);
      expect(result.error).toContain("Cannot read binary file");
      expect(result.error).toContain("PNG");
    });

    it("should detect PDF files as binary", async () => {
      sandbox.setFile("/workspace/document.pdf", createBinaryContent(1000));

      const tool = createReadTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/document.pdf",
      });

      assertError(result);
      expect(result.error).toContain("Cannot read binary file");
      expect(result.error).toContain("PDF");
    });
  });

  describe("path restrictions", () => {
    it("should block reading outside allowed paths", async () => {
      const tool = createReadTool(sandbox, {
        allowedPaths: ["/workspace/src"],
      });

      const result = await executeTool(tool, {
        file_path: "/workspace/package.json",
      });

      assertError(result);
      expect(result.error).toContain("Path not allowed");
    });

    it("should allow reading within allowed paths", async () => {
      const tool = createReadTool(sandbox, {
        allowedPaths: ["/workspace/src"],
      });

      const result = await executeTool(tool, {
        file_path: "/workspace/src/utils.ts",
      });

      assertSuccess<ReadSuccessOutput>(result);
    });

    it("should support multiple allowed paths", async () => {
      const tool = createReadTool(sandbox, {
        allowedPaths: ["/workspace/src", "/workspace/tests"],
      });

      const srcResult = await executeTool(tool, {
        file_path: "/workspace/src/index.ts",
      });
      const testResult = await executeTool(tool, {
        file_path: "/workspace/tests/index.test.ts",
      });

      assertSuccess(srcResult);
      assertSuccess(testResult);
    });
  });

  describe("error handling", () => {
    it("should handle sandbox readFile errors", async () => {
      sandbox.setExecHandler(() => {
        throw new Error("Sandbox error");
      });
      // Force readFile to throw
      const originalReadFile = sandbox.readFile.bind(sandbox);
      sandbox.readFile = async () => {
        throw new Error("Read failed");
      };

      const tool = createReadTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/src/index.ts",
      });

      assertError(result);
      expect(result.error).toBe("Read failed");

      // Restore
      sandbox.readFile = originalReadFile;
    });
  });

  describe("line number formatting", () => {
    it("should return 1-indexed line numbers", async () => {
      sandbox.setFile("/workspace/test.ts", "line1\nline2\nline3");

      const tool = createReadTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/test.ts",
      });

      assertSuccess<ReadSuccessOutput>(result);
      expect(result.type).toBe("text");
      if (result.type === "text") {
        expect(result.lines[0].line_number).toBe(1);
        expect(result.lines[1].line_number).toBe(2);
        expect(result.lines[2].line_number).toBe(3);
      }
    });

    it("should preserve correct line numbers with offset", async () => {
      sandbox.setFile(
        "/workspace/test.ts",
        "line1\nline2\nline3\nline4\nline5",
      );

      const tool = createReadTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/test.ts",
        offset: 3,
        limit: 2,
      });

      assertSuccess<ReadSuccessOutput>(result);
      expect(result.type).toBe("text");
      if (result.type === "text") {
        expect(result.lines[0].line_number).toBe(3);
        expect(result.lines[0].content).toBe("line3");
        expect(result.lines[1].line_number).toBe(4);
      }
    });
  });
});
