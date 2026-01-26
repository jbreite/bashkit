import { describe, it, expect, beforeEach } from "vitest";
import { createGlobTool, type GlobOutput } from "@/tools/glob";
import {
  createMockSandbox,
  executeTool,
  assertSuccess,
  assertError,
  type MockSandbox,
} from "@test/helpers";

describe("Glob Tool", () => {
  let sandbox: MockSandbox;

  beforeEach(() => {
    sandbox = createMockSandbox({
      files: {
        "/workspace": ["src", "tests", "package.json"],
        "/workspace/src": ["index.ts", "utils.ts", "types.ts"],
        "/workspace/tests": ["index.test.ts", "utils.test.ts"],
      },
      execHandler: (command) => {
        // Simulate find command for different patterns
        if (command.includes('"*.ts"')) {
          return {
            stdout:
              "/workspace/src/index.ts\n/workspace/src/utils.ts\n/workspace/src/types.ts\n/workspace/tests/index.test.ts\n/workspace/tests/utils.test.ts",
            stderr: "",
            exitCode: 0,
            durationMs: 10,
            interrupted: false,
          };
        }
        if (command.includes('"*.test.ts"')) {
          return {
            stdout:
              "/workspace/tests/index.test.ts\n/workspace/tests/utils.test.ts",
            stderr: "",
            exitCode: 0,
            durationMs: 10,
            interrupted: false,
          };
        }
        if (
          command.includes('"**/src/*.ts"') ||
          command.includes('"*/src/*.ts"')
        ) {
          return {
            stdout:
              "/workspace/src/index.ts\n/workspace/src/utils.ts\n/workspace/src/types.ts",
            stderr: "",
            exitCode: 0,
            durationMs: 10,
            interrupted: false,
          };
        }
        if (command.includes('"nonexistent"')) {
          return {
            stdout: "",
            stderr: "",
            exitCode: 0,
            durationMs: 5,
            interrupted: false,
          };
        }
        // Default: return empty
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: 5,
          interrupted: false,
        };
      },
    });
  });

  describe("basic pattern matching", () => {
    it("should find files matching simple pattern", async () => {
      const tool = createGlobTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "*.ts",
      });

      assertSuccess<GlobOutput>(result);
      expect(result.count).toBe(5);
      expect(result.matches).toContain("/workspace/src/index.ts");
      expect(result.matches).toContain("/workspace/tests/index.test.ts");
    });

    it("should find test files with specific pattern", async () => {
      const tool = createGlobTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "*.test.ts",
      });

      assertSuccess<GlobOutput>(result);
      expect(result.count).toBe(2);
      expect(result.matches).toContain("/workspace/tests/index.test.ts");
      expect(result.matches).toContain("/workspace/tests/utils.test.ts");
    });

    it("should handle patterns with path separators", async () => {
      const tool = createGlobTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "**/src/*.ts",
      });

      assertSuccess<GlobOutput>(result);
      expect(result.count).toBe(3);
      expect(result.matches.every((m: string) => m.includes("/src/"))).toBe(
        true,
      );
    });

    it("should return empty results for non-matching patterns", async () => {
      const tool = createGlobTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "nonexistent",
      });

      assertSuccess<GlobOutput>(result);
      expect(result.count).toBe(0);
      expect(result.matches).toEqual([]);
    });
  });

  describe("search path", () => {
    it("should search in specified path", async () => {
      const tool = createGlobTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "*.ts",
        path: "/workspace/src",
      });

      assertSuccess<GlobOutput>(result);
      expect(result.search_path).toBe("/workspace/src");
    });

    it("should use default path when not specified", async () => {
      const tool = createGlobTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "*.ts",
      });

      assertSuccess<GlobOutput>(result);
      expect(result.search_path).toBe(".");
    });
  });

  describe("path restrictions", () => {
    it("should block searches outside allowed paths", async () => {
      const tool = createGlobTool(sandbox, {
        allowedPaths: ["/workspace/src"],
      });

      const result = await executeTool(tool, {
        pattern: "*.ts",
        path: "/etc",
      });

      assertError(result);
      expect(result.error).toContain("Path not allowed");
    });

    it("should allow searches within allowed paths", async () => {
      const tool = createGlobTool(sandbox, {
        allowedPaths: ["/workspace"],
      });

      const result = await executeTool(tool, {
        pattern: "*.ts",
        path: "/workspace/src",
      });

      assertSuccess<GlobOutput>(result);
    });
  });

  describe("timeout configuration", () => {
    it("should pass configured timeout to exec", async () => {
      const tool = createGlobTool(sandbox, { timeout: 5000 });
      await executeTool(tool, {
        pattern: "*.ts",
      });

      const history = sandbox.getExecHistory();
      expect(history[0].options?.timeout).toBe(5000);
    });
  });

  describe("error handling", () => {
    it("should handle find command failures", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "",
        stderr: "find: permission denied",
        exitCode: 1,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGlobTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "*.ts",
      });

      assertError(result);
      expect(result.error).toContain("permission denied");
    });

    it("should handle sandbox.exec exceptions", async () => {
      sandbox.setExecHandler(() => {
        throw new Error("Sandbox error");
      });

      const tool = createGlobTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "*.ts",
      });

      assertError(result);
      expect(result.error).toBe("Sandbox error");
    });
  });

  describe("command construction", () => {
    it("should use -name for simple patterns", async () => {
      const tool = createGlobTool(sandbox);
      await executeTool(tool, {
        pattern: "*.ts",
      });

      const history = sandbox.getExecHistory();
      expect(history[0].command).toContain("-name");
    });

    it("should use -path for patterns with slashes", async () => {
      const tool = createGlobTool(sandbox);
      await executeTool(tool, {
        pattern: "src/**/*.ts",
      });

      const history = sandbox.getExecHistory();
      expect(history[0].command).toContain("-path");
    });

    it("should limit results to 1000 files", async () => {
      const tool = createGlobTool(sandbox);
      await executeTool(tool, {
        pattern: "*.ts",
      });

      const history = sandbox.getExecHistory();
      expect(history[0].command).toContain("head -1000");
    });
  });

  describe("result parsing", () => {
    it("should filter empty lines from output", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "/file1.ts\n\n/file2.ts\n",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGlobTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "*.ts",
      });

      assertSuccess<GlobOutput>(result);
      expect(result.count).toBe(2);
      expect(result.matches).toEqual(["/file1.ts", "/file2.ts"]);
    });

    it("should trim whitespace from paths", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "  /file1.ts  \n/file2.ts\t",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGlobTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "*.ts",
      });

      assertSuccess<GlobOutput>(result);
      expect(result.matches).toEqual(["/file1.ts", "/file2.ts"]);
    });
  });
});
