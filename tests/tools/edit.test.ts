import { describe, it, expect, beforeEach } from "vitest";
import { createEditTool, type EditOutput } from "@/tools/edit";
import {
  createMockSandbox,
  executeTool,
  assertSuccess,
  assertError,
  type MockSandbox,
} from "@test/helpers";

describe("Edit Tool", () => {
  let sandbox: MockSandbox;

  beforeEach(() => {
    sandbox = createMockSandbox({
      files: {
        "/workspace": ["src"],
        "/workspace/src": ["index.ts", "utils.ts"],
        "/workspace/src/index.ts": `import { greet } from './utils';

export function main() {
  return greet('World');
}
`,
        "/workspace/src/utils.ts": `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export function farewell(name: string): string {
  return \`Goodbye, \${name}!\`;
}
`,
      },
    });
  });

  describe("basic string replacement", () => {
    it("should replace a unique string", async () => {
      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/src/index.ts",
        old_string: "greet('World')",
        new_string: "greet('Universe')",
      });

      assertSuccess<EditOutput>(result);
      expect(result.message).toContain("Successfully edited");
      expect(result.replacements).toBe(1);

      const files = sandbox.getFiles();
      expect(files["/workspace/src/index.ts"]).toContain("greet('Universe')");
      expect(files["/workspace/src/index.ts"]).not.toContain("greet('World')");
    });

    it("should preserve indentation and whitespace", async () => {
      sandbox.setFile(
        "/workspace/test.ts",
        "function test() {\n  const x = 1;\n  const y = 2;\n}",
      );

      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/test.ts",
        old_string: "  const x = 1;",
        new_string: "  const x = 42;",
      });

      assertSuccess<EditOutput>(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/test.ts"]).toBe(
        "function test() {\n  const x = 42;\n  const y = 2;\n}",
      );
    });

    it("should replace multiline strings", async () => {
      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/src/index.ts",
        old_string: `export function main() {
  return greet('World');
}`,
        new_string: `export function main() {
  console.log('Starting...');
  return greet('World');
}`,
      });

      assertSuccess<EditOutput>(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/src/index.ts"]).toContain(
        "console.log('Starting...');",
      );
    });
  });

  describe("replace_all mode", () => {
    it("should replace all occurrences when replace_all is true", async () => {
      sandbox.setFile(
        "/workspace/test.ts",
        "const foo = 1;\nconst bar = foo;\nconst baz = foo;",
      );

      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/test.ts",
        old_string: "foo",
        new_string: "qux",
        replace_all: true,
      });

      assertSuccess<EditOutput>(result);
      expect(result.replacements).toBe(3);

      const files = sandbox.getFiles();
      expect(files["/workspace/test.ts"]).toBe(
        "const qux = 1;\nconst bar = qux;\nconst baz = qux;",
      );
    });

    it("should fail when string appears multiple times without replace_all", async () => {
      sandbox.setFile(
        "/workspace/test.ts",
        "const foo = 1;\nconst bar = foo;\nconst baz = foo;",
      );

      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/test.ts",
        old_string: "foo",
        new_string: "qux",
      });

      assertError(result);
      expect(result.error).toContain("appears 3 times");
      expect(result.error).toContain("replace_all=true");
    });

    it("should allow single occurrence without replace_all", async () => {
      sandbox.setFile("/workspace/test.ts", "const foo = 1;");

      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/test.ts",
        old_string: "foo",
        new_string: "bar",
      });

      assertSuccess<EditOutput>(result);
      expect(result.replacements).toBe(1);
    });
  });

  describe("validation", () => {
    it("should reject when old_string equals new_string", async () => {
      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/src/index.ts",
        old_string: "same",
        new_string: "same",
      });

      assertError(result);
      expect(result.error).toContain("must be different");
    });

    it("should return error when file does not exist", async () => {
      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/missing.ts",
        old_string: "foo",
        new_string: "bar",
      });

      assertError(result);
      expect(result.error).toContain("File not found");
    });

    it("should return error when old_string not found", async () => {
      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/src/index.ts",
        old_string: "nonexistent_string_xyz",
        new_string: "replacement",
      });

      assertError(result);
      expect(result.error).toContain("String not found");
    });
  });

  describe("path restrictions", () => {
    it("should block editing outside allowed paths", async () => {
      sandbox.setFile("/etc/config", "secret=value");

      const tool = createEditTool(sandbox, {
        allowedPaths: ["/workspace"],
      });

      const result = await executeTool(tool, {
        file_path: "/etc/config",
        old_string: "value",
        new_string: "newvalue",
      });

      assertError(result);
      expect(result.error).toContain("Path not allowed");
    });

    it("should allow editing within allowed paths", async () => {
      const tool = createEditTool(sandbox, {
        allowedPaths: ["/workspace"],
      });

      const result = await executeTool(tool, {
        file_path: "/workspace/src/index.ts",
        old_string: "greet('World')",
        new_string: "greet('Universe')",
      });

      assertSuccess<EditOutput>(result);
    });
  });

  describe("edge cases", () => {
    it("should handle empty old_string gracefully", async () => {
      sandbox.setFile("/workspace/test.ts", "content");

      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/test.ts",
        old_string: "",
        new_string: "prefix",
        replace_all: true,
      });

      // Empty string matches everywhere - implementation specific behavior
      assertSuccess<EditOutput>(result);
    });

    it("should handle replacement with empty string", async () => {
      sandbox.setFile(
        "/workspace/test.ts",
        "const DEBUG = true;\nconst x = 1;",
      );

      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/test.ts",
        old_string: "const DEBUG = true;\n",
        new_string: "",
      });

      assertSuccess<EditOutput>(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/test.ts"]).toBe("const x = 1;");
    });

    it("should handle special regex characters in old_string", async () => {
      sandbox.setFile("/workspace/test.ts", "const regex = /[a-z]+/g;");

      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/test.ts",
        old_string: "/[a-z]+/g",
        new_string: "/[A-Z]+/g",
      });

      assertSuccess<EditOutput>(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/test.ts"]).toBe("const regex = /[A-Z]+/g;");
    });

    it("should handle newlines in strings", async () => {
      sandbox.setFile("/workspace/test.ts", "line1\nline2\nline3");

      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/test.ts",
        old_string: "line1\nline2",
        new_string: "lineA\nlineB",
      });

      assertSuccess<EditOutput>(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/test.ts"]).toBe("lineA\nlineB\nline3");
    });
  });

  describe("error handling", () => {
    it("should handle sandbox readFile errors", async () => {
      const originalReadFile = sandbox.readFile.bind(sandbox);
      sandbox.readFile = async () => {
        throw new Error("Read permission denied");
      };

      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/src/index.ts",
        old_string: "foo",
        new_string: "bar",
      });

      assertError(result);
      expect(result.error).toBe("Read permission denied");

      sandbox.readFile = originalReadFile;
    });

    it("should handle sandbox writeFile errors", async () => {
      const originalWriteFile = sandbox.writeFile.bind(sandbox);
      sandbox.writeFile = async () => {
        throw new Error("Disk full");
      };

      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/src/index.ts",
        old_string: "greet('World')",
        new_string: "greet('Universe')",
      });

      assertError(result);
      expect(result.error).toBe("Disk full");

      sandbox.writeFile = originalWriteFile;
    });
  });

  describe("replacement count", () => {
    it("should report correct replacement count for single replacement", async () => {
      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/src/index.ts",
        old_string: "greet('World')",
        new_string: "greet('Universe')",
      });

      assertSuccess<EditOutput>(result);
      expect(result.replacements).toBe(1);
    });

    it("should report correct replacement count for multiple replacements", async () => {
      sandbox.setFile("/workspace/test.ts", "a a a a a");

      const tool = createEditTool(sandbox);
      const result = await executeTool(tool, {
        file_path: "/workspace/test.ts",
        old_string: "a",
        new_string: "b",
        replace_all: true,
      });

      assertSuccess<EditOutput>(result);
      expect(result.replacements).toBe(5);
    });
  });
});
