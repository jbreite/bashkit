import { describe, it, expect, beforeEach } from "vitest";
import { createWriteTool, type WriteOutput } from "@/tools/write";
import {
  createMockSandbox,
  executeTool,
  assertSuccess,
  assertError,
  type MockSandbox,
} from "@test/helpers";

describe("Write Tool", () => {
  let sandbox: MockSandbox;

  beforeEach(() => {
    sandbox = createMockSandbox({
      files: {
        "/workspace": ["src", "package.json"],
        "/workspace/src": ["index.ts"],
        "/workspace/src/index.ts": "// existing file",
      },
    });
  });

  describe("basic file writing", () => {
    it("should write content to a new file", async () => {
      const tool = createWriteTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/new-file.ts",
        content: "const x = 1;",
      });

      assertSuccess<WriteOutput>(result);
      expect(result.message).toContain("Successfully wrote");
      expect(result.file_path).toBe("/workspace/new-file.ts");
      expect(result.bytes_written).toBe(12);

      // Verify file was written
      const files = sandbox.getFiles();
      expect(files["/workspace/new-file.ts"]).toBe("const x = 1;");
    });

    it("should overwrite existing file", async () => {
      const tool = createWriteTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/src/index.ts",
        content: "// completely new content",
      });

      assertSuccess<WriteOutput>(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/src/index.ts"]).toBe(
        "// completely new content",
      );
    });

    it("should report correct byte count for content", async () => {
      const tool = createWriteTool(sandbox);
      const content = "Hello, World!";
      const result = await executeTool(tool, {
        file_path: "/workspace/test.txt",
        content,
      });

      assertSuccess<WriteOutput>(result);
      expect(result.bytes_written).toBe(Buffer.byteLength(content, "utf-8"));
    });

    it("should handle unicode content correctly", async () => {
      const tool = createWriteTool(sandbox);
      const content = "Hello, 世界! 🌍";
      const result = await executeTool(tool, {
        file_path: "/workspace/unicode.txt",
        content,
      });

      assertSuccess<WriteOutput>(result);
      // Unicode characters take more bytes
      expect(result.bytes_written).toBeGreaterThan(content.length);
    });

    it("should handle empty content", async () => {
      const tool = createWriteTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/empty.txt",
        content: "",
      });

      assertSuccess<WriteOutput>(result);
      expect(result.bytes_written).toBe(0);
    });
  });

  describe("file size limits", () => {
    it("should reject content exceeding maxFileSize", async () => {
      const tool = createWriteTool(sandbox, { maxFileSize: 100 });
      const result = await executeTool(tool, {
        file_path: "/workspace/large.txt",
        content: "x".repeat(200),
      });

      assertError(result);
      expect(result.error).toContain("exceeds maximum size");
      expect(result.error).toContain("100 bytes");
    });

    it("should allow content within maxFileSize", async () => {
      const tool = createWriteTool(sandbox, { maxFileSize: 100 });
      const result = await executeTool(tool, {
        file_path: "/workspace/small.txt",
        content: "x".repeat(50),
      });

      assertSuccess<WriteOutput>(result);
    });

    it("should allow exactly maxFileSize bytes", async () => {
      const tool = createWriteTool(sandbox, { maxFileSize: 100 });
      const result = await executeTool(tool, {
        file_path: "/workspace/exact.txt",
        content: "x".repeat(100),
      });

      assertSuccess<WriteOutput>(result);
      expect(result.bytes_written).toBe(100);
    });
  });

  describe("path restrictions", () => {
    it("should block writing outside allowed paths", async () => {
      const tool = createWriteTool(sandbox, {
        allowedPaths: ["/workspace/src"],
      });

      const result = await executeTool(tool, {
        file_path: "/workspace/package.json",
        content: "{}",
      });

      assertError(result);
      expect(result.error).toContain("Path not allowed");
    });

    it("should allow writing within allowed paths", async () => {
      const tool = createWriteTool(sandbox, {
        allowedPaths: ["/workspace/src"],
      });

      const result = await executeTool(tool, {
        file_path: "/workspace/src/new-file.ts",
        content: "const x = 1;",
      });

      assertSuccess<WriteOutput>(result);
    });

    it("should support multiple allowed paths", async () => {
      const tool = createWriteTool(sandbox, {
        allowedPaths: ["/workspace/src", "/workspace/tests"],
      });

      const srcResult = await executeTool(tool, {
        file_path: "/workspace/src/file.ts",
        content: "src content",
      });
      assertSuccess(srcResult);

      const testResult = await executeTool(tool, {
        file_path: "/workspace/tests/file.test.ts",
        content: "test content",
      });
      assertSuccess(testResult);
    });

    it("should block writing to parent directories via path traversal", async () => {
      const tool = createWriteTool(sandbox, {
        allowedPaths: ["/workspace/src"],
      });

      const result = await executeTool(tool, {
        file_path: "/etc/passwd",
        content: "malicious",
      });

      assertError(result);
      expect(result.error).toContain("Path not allowed");
    });
  });

  describe("error handling", () => {
    it("should handle sandbox writeFile errors", async () => {
      const originalWriteFile = sandbox.writeFile.bind(sandbox);
      sandbox.writeFile = async () => {
        throw new Error("Disk full");
      };

      const tool = createWriteTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/test.txt",
        content: "test",
      });

      assertError(result);
      expect(result.error).toBe("Disk full");

      sandbox.writeFile = originalWriteFile;
    });

    it("should handle non-Error throws", async () => {
      sandbox.writeFile = async () => {
        throw "string error";
      };

      const tool = createWriteTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/test.txt",
        content: "test",
      });

      assertError(result);
      expect(result.error).toBe("Unknown error");
    });
  });

  describe("multiline content", () => {
    it("should preserve line endings", async () => {
      const tool = createWriteTool(sandbox);
      const content = "line1\nline2\nline3";
      const result = await executeTool(tool, {
        file_path: "/workspace/multiline.txt",
        content,
      });

      assertSuccess<WriteOutput>(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/multiline.txt"]).toBe(content);
    });

    it("should handle Windows line endings", async () => {
      const tool = createWriteTool(sandbox);
      const content = "line1\r\nline2\r\nline3";
      const result = await executeTool(tool, {
        file_path: "/workspace/windows.txt",
        content,
      });

      assertSuccess<WriteOutput>(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/windows.txt"]).toBe(content);
    });
  });
});
