import { describe, it, expect, beforeEach } from "vitest";
import {
  createGrepTool,
  type GrepFilesOutput,
  type GrepContentOutput,
  type GrepCountOutput,
} from "@/tools/grep";
import {
  createMockSandbox,
  executeTool,
  assertSuccess,
  assertError,
  createRipgrepOutput,
  type MockSandbox,
} from "@test/helpers";

/** GrepOutput without error type for successful assertions */
type GrepSuccessOutput = GrepFilesOutput | GrepContentOutput | GrepCountOutput;

describe("Grep Tool", () => {
  let sandbox: MockSandbox;

  beforeEach(() => {
    sandbox = createMockSandbox({
      rgPath: "/usr/bin/rg",
      files: {
        "/workspace": ["src"],
        "/workspace/src": ["index.ts", "utils.ts"],
      },
    });
  });

  describe("basic search", () => {
    it("should find files with matching pattern (files_with_matches mode)", async () => {
      sandbox.setExecHandler(() => ({
        stdout: createRipgrepOutput([
          {
            path: "/workspace/src/index.ts",
            lineNumber: 1,
            lineContent: "function test() {",
          },
          {
            path: "/workspace/src/utils.ts",
            lineNumber: 5,
            lineContent: "function helper() {",
          },
        ]),
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "function",
      });

      assertSuccess<GrepSuccessOutput>(result);
      expect("files" in result).toBe(true);
      if ("files" in result) {
        expect(result.files).toContain("/workspace/src/index.ts");
        expect(result.count).toBeGreaterThan(0);
      }
    });

    it("should return content in content mode", async () => {
      sandbox.setExecHandler(() => ({
        stdout: createRipgrepOutput([
          {
            path: "/workspace/src/index.ts",
            lineNumber: 10,
            lineContent: "const x = 1;",
          },
        ]),
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "const",
        output_mode: "content",
      });

      assertSuccess<GrepSuccessOutput>(result);
      expect("matches" in result).toBe(true);
      if ("matches" in result) {
        expect(result.matches.length).toBeGreaterThan(0);
        expect(result.matches[0].file).toBe("/workspace/src/index.ts");
        expect(result.matches[0].line_number).toBe(10);
        expect(result.matches[0].line).toContain("const");
      }
    });

    it("should return counts in count mode", async () => {
      // Create ripgrep JSON output for count mode
      const countOutput = [
        JSON.stringify({
          type: "begin",
          data: { path: { text: "/workspace/src/index.ts" } },
        }),
        JSON.stringify({
          type: "match",
          data: {
            path: { text: "/workspace/src/index.ts" },
            lines: { text: "const a" },
            line_number: 1,
            submatches: [],
          },
        }),
        JSON.stringify({
          type: "match",
          data: {
            path: { text: "/workspace/src/index.ts" },
            lines: { text: "const b" },
            line_number: 2,
            submatches: [],
          },
        }),
        JSON.stringify({
          type: "end",
          data: {
            path: { text: "/workspace/src/index.ts" },
            stats: { matches: 2 },
          },
        }),
        JSON.stringify({ type: "summary", data: { stats: { matches: 2 } } }),
      ].join("\n");

      sandbox.setExecHandler(() => ({
        stdout: countOutput,
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "const",
        output_mode: "count",
      });

      assertSuccess<GrepSuccessOutput>(result);
      expect("counts" in result).toBe(true);
      if ("counts" in result) {
        expect(result.total).toBe(2);
        expect(result.counts[0].file).toBe("/workspace/src/index.ts");
        expect(result.counts[0].count).toBe(2);
      }
    });
  });

  describe("ripgrep path requirement", () => {
    it("should return error when rgPath is not set", async () => {
      const sandboxNoRg = createMockSandbox({
        rgPath: undefined,
      });

      const tool = createGrepTool(sandboxNoRg);
      const result = await executeTool(tool, {
        pattern: "test",
      });

      assertError(result);
      expect(result.error).toContain("Ripgrep not available");
    });
  });

  describe("command options", () => {
    it("should add case insensitive flag", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      await executeTool(tool, {
        pattern: "test",
        "-i": true,
      });

      const history = sandbox.getExecHistory();
      expect(history[0].command).toContain(" -i");
    });

    it("should add multiline flag", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      await executeTool(tool, {
        pattern: "test",
        multiline: true,
      });

      const history = sandbox.getExecHistory();
      expect(history[0].command).toContain("-U");
      expect(history[0].command).toContain("--multiline-dotall");
    });

    it("should add glob filter", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      await executeTool(tool, {
        pattern: "test",
        glob: "*.ts",
      });

      const history = sandbox.getExecHistory();
      expect(history[0].command).toContain('-g "*.ts"');
    });

    it("should add type filter", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      await executeTool(tool, {
        pattern: "test",
        type: "ts",
      });

      const history = sandbox.getExecHistory();
      expect(history[0].command).toContain("-t ts");
    });
  });

  describe("context options", () => {
    it("should add before context in content mode", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      await executeTool(tool, {
        pattern: "test",
        output_mode: "content",
        "-B": 3,
      });

      const history = sandbox.getExecHistory();
      expect(history[0].command).toContain("-B 3");
    });

    it("should add after context in content mode", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      await executeTool(tool, {
        pattern: "test",
        output_mode: "content",
        "-A": 2,
      });

      const history = sandbox.getExecHistory();
      expect(history[0].command).toContain("-A 2");
    });

    it("should use -C for combined context", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      await executeTool(tool, {
        pattern: "test",
        output_mode: "content",
        "-C": 5,
      });

      const history = sandbox.getExecHistory();
      expect(history[0].command).toContain("-C 5");
      // When -C is used, -A and -B should not be added
      expect(history[0].command).not.toContain("-A");
      expect(history[0].command).not.toContain("-B");
    });

    it("should not add context flags for files_with_matches mode", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      await executeTool(tool, {
        pattern: "test",
        output_mode: "files_with_matches",
        "-B": 3,
        "-A": 3,
      });

      const history = sandbox.getExecHistory();
      expect(history[0].command).not.toContain("-B");
      expect(history[0].command).not.toContain("-A");
    });
  });

  describe("path restrictions", () => {
    it("should block searches outside allowed paths", async () => {
      const tool = createGrepTool(sandbox, {
        allowedPaths: ["/workspace"],
      });

      const result = await executeTool(tool, {
        pattern: "password",
        path: "/etc",
      });

      assertError(result);
      expect(result.error).toContain("Path not allowed");
    });

    it("should allow searches within allowed paths", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox, {
        allowedPaths: ["/workspace"],
      });

      const result = await executeTool(tool, {
        pattern: "test",
        path: "/workspace/src",
      });

      assertSuccess<GrepSuccessOutput>(result);
    });
  });

  describe("pagination", () => {
    it("should apply offset to content results", async () => {
      // Create output with multiple matches
      const matchOutput = [
        JSON.stringify({ type: "begin", data: { path: { text: "/file.ts" } } }),
        JSON.stringify({
          type: "match",
          data: {
            path: { text: "/file.ts" },
            lines: { text: "match 1" },
            line_number: 1,
            submatches: [],
          },
        }),
        JSON.stringify({
          type: "match",
          data: {
            path: { text: "/file.ts" },
            lines: { text: "match 2" },
            line_number: 2,
            submatches: [],
          },
        }),
        JSON.stringify({
          type: "match",
          data: {
            path: { text: "/file.ts" },
            lines: { text: "match 3" },
            line_number: 3,
            submatches: [],
          },
        }),
        JSON.stringify({
          type: "end",
          data: { path: { text: "/file.ts" }, stats: { matches: 3 } },
        }),
      ].join("\n");

      sandbox.setExecHandler(() => ({
        stdout: matchOutput,
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "match",
        output_mode: "content",
        offset: 1,
      });

      assertSuccess<GrepSuccessOutput>(result);
      expect("matches" in result).toBe(true);
      if ("matches" in result) {
        expect(result.matches.length).toBe(2);
        expect(result.matches[0].line).toContain("match 2");
      }
    });

    it("should apply head_limit to content results", async () => {
      const matchOutput = [
        JSON.stringify({ type: "begin", data: { path: { text: "/file.ts" } } }),
        JSON.stringify({
          type: "match",
          data: {
            path: { text: "/file.ts" },
            lines: { text: "match 1" },
            line_number: 1,
            submatches: [],
          },
        }),
        JSON.stringify({
          type: "match",
          data: {
            path: { text: "/file.ts" },
            lines: { text: "match 2" },
            line_number: 2,
            submatches: [],
          },
        }),
        JSON.stringify({
          type: "match",
          data: {
            path: { text: "/file.ts" },
            lines: { text: "match 3" },
            line_number: 3,
            submatches: [],
          },
        }),
        JSON.stringify({
          type: "end",
          data: { path: { text: "/file.ts" }, stats: { matches: 3 } },
        }),
      ].join("\n");

      sandbox.setExecHandler(() => ({
        stdout: matchOutput,
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "match",
        output_mode: "content",
        head_limit: 2,
      });

      assertSuccess<GrepSuccessOutput>(result);
      expect("matches" in result).toBe(true);
      if ("matches" in result) {
        expect(result.matches.length).toBe(2);
      }
    });
  });

  describe("error handling", () => {
    it("should handle sandbox.exec exceptions", async () => {
      sandbox.setExecHandler(() => {
        throw new Error("Ripgrep execution failed");
      });

      const tool = createGrepTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "test",
      });

      assertError(result);
      expect(result.error).toBe("Ripgrep execution failed");
    });

    it("should handle malformed JSON in output", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "not valid json\nstill not valid",
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "test",
      });

      // Should not throw, just return empty results
      assertSuccess<GrepSuccessOutput>(result);
      expect("files" in result).toBe(true);
      if ("files" in result) {
        expect(result.count).toBe(0);
      }
    });
  });

  describe("JSON output parsing", () => {
    it("should always use --json flag", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      await executeTool(tool, {
        pattern: "test",
      });

      const history = sandbox.getExecHistory();
      expect(history[0].command).toContain("--json");
    });
  });

  describe("default values", () => {
    it("should use files_with_matches as default output mode", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      const result = await executeTool(tool, {
        pattern: "test",
      });

      assertSuccess<GrepSuccessOutput>(result);
      expect("files" in result).toBe(true);
    });

    it("should use current directory when path not specified", async () => {
      sandbox.setExecHandler(() => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        interrupted: false,
      }));

      const tool = createGrepTool(sandbox);
      await executeTool(tool, {
        pattern: "test",
      });

      const history = sandbox.getExecHistory();
      expect(history[0].command).toMatch(/\.\s*2>/);
    });
  });
});
