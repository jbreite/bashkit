import { describe, it, expect, beforeEach } from "vitest";
import type { Sandbox } from "@/sandbox/interface";
import { createPatchTool, type PatchOutput } from "@/tools/patch";
import { parsePatch, parseUpdateFileChunk } from "@/tools/patch/parser";
import { seekSequence, normalizeUnicode } from "@/tools/patch/seek-sequence";
import { deriveNewContents } from "@/tools/patch/apply";
import {
  createMockSandbox,
  executeTool,
  assertSuccess,
  assertError,
  type MockSandbox,
} from "@test/helpers";

// ============================================================
// Parser Tests — matching Codex parser.rs test cases
// ============================================================

describe("parsePatch", () => {
  it("should reject bad input", () => {
    expect(() => parsePatch("bad")).toThrow(
      "The first line of the patch must be '*** Begin Patch'",
    );
  });

  it("should reject missing end marker", () => {
    expect(() => parsePatch("*** Begin Patch\nbad")).toThrow(
      "The last line of the patch must be '*** End Patch'",
    );
  });

  it("should parse Add/Delete/Update in one patch", () => {
    const result = parsePatch(
      "*** Begin Patch\n" +
        "*** Add File: path/add.py\n" +
        "+abc\n" +
        "+def\n" +
        "*** Delete File: path/delete.py\n" +
        "*** Update File: path/update.py\n" +
        "*** Move to: path/update2.py\n" +
        "@@ def f():\n" +
        "-    pass\n" +
        "+    return 123\n" +
        "*** End Patch",
    );

    expect(result.hunks).toHaveLength(3);

    // Add hunk
    const add = result.hunks[0];
    expect(add.type).toBe("add");
    if (add.type === "add") {
      expect(add.path).toBe("path/add.py");
      expect(add.content).toBe("abc\ndef\n");
    }

    // Delete hunk
    const del = result.hunks[1];
    expect(del.type).toBe("delete");
    if (del.type === "delete") {
      expect(del.path).toBe("path/delete.py");
    }

    // Update hunk with move and change_context
    const upd = result.hunks[2];
    expect(upd.type).toBe("update");
    if (upd.type === "update") {
      expect(upd.path).toBe("path/update.py");
      expect(upd.movePath).toBe("path/update2.py");
      expect(upd.chunks).toHaveLength(1);
      expect(upd.chunks[0].changeContext).toBe("def f():");
      expect(upd.chunks[0].oldLines).toEqual(["    pass"]);
      expect(upd.chunks[0].newLines).toEqual(["    return 123"]);
      expect(upd.chunks[0].isEndOfFile).toBe(false);
    }
  });

  it("should parse empty patch (no hunks)", () => {
    const result = parsePatch("*** Begin Patch\n*** End Patch");
    expect(result.hunks).toHaveLength(0);
  });

  it("should parse Update hunk followed by Add hunk", () => {
    const result = parsePatch(
      "*** Begin Patch\n" +
        "*** Update File: file.py\n" +
        "@@\n" +
        "+line\n" +
        "*** Add File: other.py\n" +
        "+content\n" +
        "*** End Patch",
    );
    expect(result.hunks).toHaveLength(2);
    const upd = result.hunks[0];
    if (upd.type === "update") {
      expect(upd.chunks[0].changeContext).toBeNull();
      expect(upd.chunks[0].oldLines).toEqual([]);
      expect(upd.chunks[0].newLines).toEqual(["line"]);
    }
    const add = result.hunks[1];
    if (add.type === "add") {
      expect(add.content).toBe("content\n");
    }
  });

  it("should parse first chunk without @@ header (space-prefixed context goes to old+new)", () => {
    // Codex test: " import foo\n+bar" without @@ → old=["import foo"], new=["import foo","bar"]
    const result = parsePatch(
      "*** Begin Patch\n" +
        "*** Update File: file2.py\n" +
        " import foo\n" +
        "+bar\n" +
        "*** End Patch",
    );

    expect(result.hunks).toHaveLength(1);
    const upd = result.hunks[0];
    if (upd.type === "update") {
      expect(upd.chunks[0].changeContext).toBeNull();
      expect(upd.chunks[0].oldLines).toEqual(["import foo"]);
      expect(upd.chunks[0].newLines).toEqual(["import foo", "bar"]);
    }
  });

  it("should reject empty Update file hunk", () => {
    expect(() =>
      parsePatch("*** Begin Patch\n*** Update File: test.py\n*** End Patch"),
    ).toThrow("Update file hunk for path 'test.py' is empty");
  });

  it("should handle heredoc wrapping (lenient mode)", () => {
    const result = parsePatch(
      "<<'EOF'\n" +
        "*** Begin Patch\n" +
        "*** Delete File: src/old.ts\n" +
        "*** End Patch\n" +
        "EOF\n",
    );
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].type).toBe("delete");
  });

  it("should handle trimmed Begin/End markers", () => {
    const result = parsePatch(
      "  *** Begin Patch  \n" +
        "*** Delete File: test.ts\n" +
        "  *** End Patch  ",
    );
    expect(result.hunks).toHaveLength(1);
  });

  it("should parse End of File marker", () => {
    const result = parsePatch(
      "*** Begin Patch\n" +
        "*** Update File: test.ts\n" +
        "@@\n" +
        "+line\n" +
        "*** End of File\n" +
        "*** End Patch",
    );
    const upd = result.hunks[0];
    if (upd.type === "update") {
      expect(upd.chunks[0].isEndOfFile).toBe(true);
    }
  });

  it("should parse multi-chunk updates with @@ headers", () => {
    const result = parsePatch(
      "*** Begin Patch\n" +
        "*** Update File: src/main.ts\n" +
        "@@ func a():\n" +
        "-old_a\n" +
        "+new_a\n" +
        "@@ func b():\n" +
        "-old_b\n" +
        "+new_b\n" +
        "*** End Patch",
    );
    const upd = result.hunks[0];
    if (upd.type === "update") {
      expect(upd.chunks).toHaveLength(2);
      expect(upd.chunks[0].changeContext).toBe("func a():");
      expect(upd.chunks[1].changeContext).toBe("func b():");
    }
  });
});

// ============================================================
// parseUpdateFileChunk Tests — matching Codex test_update_file_chunk
// ============================================================

describe("parseUpdateFileChunk", () => {
  it("should reject non-@@ start when context required", () => {
    expect(() => parseUpdateFileChunk(["bad"], 123, false)).toThrow(
      "Expected update hunk to start with a @@ context marker, got: 'bad'",
    );
  });

  it("should reject bare @@ with no diff lines", () => {
    expect(() => parseUpdateFileChunk(["@@"], 123, false)).toThrow(
      "Update hunk does not contain any lines",
    );
  });

  it("should reject @@ followed by non-diff line", () => {
    expect(() => parseUpdateFileChunk(["@@", "bad"], 123, false)).toThrow(
      "Unexpected line found in update hunk: 'bad'",
    );
  });

  it("should reject @@ followed by End of File with no diff lines", () => {
    expect(() =>
      parseUpdateFileChunk(["@@", "*** End of File"], 123, false),
    ).toThrow("Update hunk does not contain any lines");
  });

  it("should parse chunk with context, empty line, context, removal, addition, and trailing context", () => {
    // Codex test: @@ change_context / (empty) / " context" / -remove / +add / " context2" / *** End Patch
    const result = parseUpdateFileChunk(
      [
        "@@ change_context",
        "",
        " context",
        "-remove",
        "+add",
        " context2",
        "*** End Patch",
      ],
      123,
      false,
    );
    expect(result.chunk).toEqual({
      changeContext: "change_context",
      oldLines: ["", "context", "remove", "context2"],
      newLines: ["", "context", "add", "context2"],
      isEndOfFile: false,
    });
    expect(result.linesConsumed).toBe(6);
  });

  it("should parse chunk with End of File marker", () => {
    const result = parseUpdateFileChunk(
      ["@@", "+line", "*** End of File"],
      123,
      false,
    );
    expect(result.chunk).toEqual({
      changeContext: null,
      oldLines: [],
      newLines: ["line"],
      isEndOfFile: true,
    });
    expect(result.linesConsumed).toBe(3);
  });
});

// ============================================================
// seekSequence Tests — matching Codex seek_sequence.rs tests
// ============================================================

describe("seekSequence", () => {
  it("should find exact match", () => {
    const lines = ["foo", "bar", "baz"];
    expect(seekSequence(lines, ["bar", "baz"], 0, false)).toBe(1);
  });

  it("should find match with trailing whitespace (trimEnd)", () => {
    const lines = ["foo   ", "bar\t\t"];
    expect(seekSequence(lines, ["foo", "bar"], 0, false)).toBe(0);
  });

  it("should find match with leading and trailing whitespace (trim)", () => {
    const lines = ["    foo   ", "   bar\t"];
    expect(seekSequence(lines, ["foo", "bar"], 0, false)).toBe(0);
  });

  it("should return null when pattern longer than input", () => {
    const lines = ["just one line"];
    expect(seekSequence(lines, ["too", "many", "lines"], 0, false)).toBeNull();
  });

  it("should return start for empty pattern", () => {
    expect(seekSequence(["a", "b"], [], 3, false)).toBe(3);
  });

  it("should return null when pattern not found", () => {
    const lines = ["line 1", "line 2", "line 3"];
    expect(seekSequence(lines, ["not found"], 0, false)).toBeNull();
  });

  it("should handle eof flag — search starts from end", () => {
    const lines = ["a", "b", "c", "d"];
    expect(seekSequence(lines, ["c", "d"], 0, true)).toBe(2);
  });

  it("should respect start parameter", () => {
    const lines = ["target", "other", "target", "other"];
    expect(seekSequence(lines, ["target"], 1, false)).toBe(2);
  });

  it("should prefer exact match over fuzzy at earlier position (global tier priority)", () => {
    // Codex does 4 separate passes: exact match wins globally.
    // Line 0 has trailing whitespace (trimEnd match only),
    // Line 2 is exact match → should return 2, not 0.
    const lines = ["hello  ", "world", "hello"];
    expect(seekSequence(lines, ["hello"], 0, false)).toBe(2);
  });

  it("should find Unicode-normalized match", () => {
    const lines = ["\u201CHello\u201D", "world"];
    expect(seekSequence(lines, ['"Hello"', "world"], 0, false)).toBe(0);
  });
});

describe("normalizeUnicode", () => {
  it("should normalize typographic dashes", () => {
    expect(normalizeUnicode("a\u2014b")).toBe("a-b"); // em dash
    expect(normalizeUnicode("a\u2013b")).toBe("a-b"); // en dash
    expect(normalizeUnicode("a\u2212b")).toBe("a-b"); // minus sign
  });

  it("should normalize typographic quotes", () => {
    expect(normalizeUnicode("\u2018hello\u2019")).toBe("'hello'");
    expect(normalizeUnicode("\u201Chello\u201D")).toBe('"hello"');
  });

  it("should normalize special spaces", () => {
    expect(normalizeUnicode("a\u00A0b")).toBe("a b");
    expect(normalizeUnicode("a\u2003b")).toBe("a b");
  });

  it("should trim whitespace", () => {
    expect(normalizeUnicode("  hello  ")).toBe("hello");
  });
});

// ============================================================
// Apply Tests — matching Codex lib.rs test cases
// ============================================================

describe("deriveNewContents", () => {
  it("should apply basic update (Codex: test_update_file_hunk_modifies_content)", () => {
    // Original: "foo\nbar\n", patch: @@ / " foo" / "-bar" / "+baz"
    const original = "foo\nbar\n";
    const chunks = [
      {
        changeContext: null,
        oldLines: ["foo", "bar"],
        newLines: ["foo", "baz"],
        isEndOfFile: false,
      },
    ];
    expect(deriveNewContents(original, chunks, "test.txt")).toBe("foo\nbaz\n");
  });

  it("should apply move with replacement (Codex: test_update_file_hunk_can_move_file)", () => {
    const original = "line\n";
    const chunks = [
      {
        changeContext: null,
        oldLines: ["line"],
        newLines: ["line2"],
        isEndOfFile: false,
      },
    ];
    expect(deriveNewContents(original, chunks, "src.txt")).toBe("line2\n");
  });

  it("should apply multiple chunks to single file (Codex: test_multiple_update_chunks)", () => {
    // foo\nbar\nbaz\nqux\n → foo\nBAR\nbaz\nQUX\n
    const original = "foo\nbar\nbaz\nqux\n";
    const chunks = [
      {
        changeContext: null,
        oldLines: ["foo", "bar"],
        newLines: ["foo", "BAR"],
        isEndOfFile: false,
      },
      {
        changeContext: null,
        oldLines: ["baz", "qux"],
        newLines: ["baz", "QUX"],
        isEndOfFile: false,
      },
    ];
    expect(deriveNewContents(original, chunks, "multi.txt")).toBe(
      "foo\nBAR\nbaz\nQUX\n",
    );
  });

  it("should handle interleaved changes with EOF append (Codex: test_update_file_hunk_interleaved_changes)", () => {
    // a\nb\nc\nd\ne\nf\n → a\nB\nc\nd\nE\nf\ng\n
    const original = "a\nb\nc\nd\ne\nf\n";
    const chunks = [
      {
        changeContext: null,
        oldLines: ["a", "b"],
        newLines: ["a", "B"],
        isEndOfFile: false,
      },
      {
        changeContext: null,
        oldLines: ["c", "d", "e"],
        newLines: ["c", "d", "E"],
        isEndOfFile: false,
      },
      {
        changeContext: null,
        oldLines: ["f"],
        newLines: ["f", "g"],
        isEndOfFile: true,
      },
    ];
    expect(deriveNewContents(original, chunks, "interleaved.txt")).toBe(
      "a\nB\nc\nd\nE\nf\ng\n",
    );
  });

  it("should handle pure addition followed by removal (Codex: test_pure_addition_chunk_followed_by_removal)", () => {
    // line1\nline2\nline3\n
    // Chunk 1: pure addition (old=[], new=["after-context","second-line"])
    // Chunk 2: old=["line1","line2","line3"], new=["line1","line2-replacement"]
    const original = "line1\nline2\nline3\n";
    const chunks = [
      {
        changeContext: null,
        oldLines: [],
        newLines: ["after-context", "second-line"],
        isEndOfFile: false,
      },
      {
        changeContext: null,
        oldLines: ["line1", "line2", "line3"],
        newLines: ["line1", "line2-replacement"],
        isEndOfFile: false,
      },
    ];
    expect(deriveNewContents(original, chunks, "panic.txt")).toBe(
      "line1\nline2-replacement\nafter-context\nsecond-line\n",
    );
  });

  it("should throw when context not found", () => {
    const original = "line1\nline2\n";
    const chunks = [
      {
        changeContext: "nonexistent",
        oldLines: ["line1"],
        newLines: ["replaced"],
        isEndOfFile: false,
      },
    ];
    expect(() => deriveNewContents(original, chunks, "test.ts")).toThrow(
      "Failed to find context",
    );
  });

  it("should throw when old lines not found", () => {
    const original = "line1\nline2\n";
    const chunks = [
      {
        changeContext: null,
        oldLines: ["nonexistent"],
        newLines: ["replaced"],
        isEndOfFile: false,
      },
    ];
    expect(() => deriveNewContents(original, chunks, "test.ts")).toThrow(
      "Failed to find expected lines",
    );
  });
});

// ============================================================
// Tool Integration Tests
// ============================================================

describe("Patch Tool", () => {
  let sandbox: MockSandbox;

  beforeEach(() => {
    sandbox = createMockSandbox({
      files: {
        "/workspace/src/main.ts": `export function hello() {\n  return "world";\n}\n`,
        "/workspace/src/utils.ts": `export function add(a: number, b: number) {\n  return a + b;\n}\n\nexport function sub(a: number, b: number) {\n  return a - b;\n}\n`,
        "/workspace/src/old.ts": `// This file is deprecated\n`,
      },
    });
  });

  describe("Add File", () => {
    it("should create a new file", async () => {
      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Add File: /workspace/src/new.ts
+export const x = 1;
+export const y = 2;
*** End Patch`,
      });

      assertSuccess<PatchOutput>(result);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].status).toBe("added");
      expect(result.files[0].path).toBe("/workspace/src/new.ts");

      const files = sandbox.getFiles();
      expect(files["/workspace/src/new.ts"]).toContain("export const x = 1;");
    });
  });

  describe("Delete File", () => {
    it("should delete an existing file", async () => {
      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Delete File: /workspace/src/old.ts
*** End Patch`,
      });

      assertSuccess<PatchOutput>(result);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].status).toBe("deleted");

      const files = sandbox.getFiles();
      expect(files["/workspace/src/old.ts"]).toBeUndefined();
    });

    it("should error when deleting non-existent file", async () => {
      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Delete File: /workspace/src/missing.ts
*** End Patch`,
      });

      assertError(result);
      expect(result.error).toContain("File not found for deletion");
    });
  });

  describe("Update File", () => {
    it("should update an existing file with context line in diff body", async () => {
      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Update File: /workspace/src/main.ts
@@
 export function hello() {
-  return "world";
+  return "universe";
*** End Patch`,
      });

      assertSuccess<PatchOutput>(result);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].status).toBe("modified");

      const files = sandbox.getFiles();
      expect(files["/workspace/src/main.ts"]).toContain('"universe"');
      expect(files["/workspace/src/main.ts"]).not.toContain('"world"');
    });

    it("should error when updating non-existent file", async () => {
      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Update File: /workspace/src/missing.ts
@@
-old
+new
*** End Patch`,
      });

      assertError(result);
      expect(result.error).toContain("File not found");
    });

    it("should handle update with change_context for narrowing", async () => {
      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Update File: /workspace/src/main.ts
@@ export function hello() {
-  return "world";
+  return "universe";
*** End Patch`,
      });

      assertSuccess<PatchOutput>(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/src/main.ts"]).toContain('"universe"');
    });
  });

  describe("Multi-file patches", () => {
    it("should apply changes to multiple files", async () => {
      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Update File: /workspace/src/main.ts
@@
 export function hello() {
-  return "world";
+  return "universe";
*** Delete File: /workspace/src/old.ts
*** Add File: /workspace/src/config.ts
+export const VERSION = "1.0.0";
*** End Patch`,
      });

      assertSuccess<PatchOutput>(result);
      expect(result.files).toHaveLength(3);
      expect(result.message).toContain("3 files");

      const files = sandbox.getFiles();
      expect(files["/workspace/src/main.ts"]).toContain('"universe"');
      expect(files["/workspace/src/old.ts"]).toBeUndefined();
      expect(files["/workspace/src/config.ts"]).toContain("VERSION");
    });
  });

  describe("Move/Rename", () => {
    it("should rename a file during update", async () => {
      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Update File: /workspace/src/main.ts
*** Move to: /workspace/src/renamed.ts
@@
 export function hello() {
-  return "world";
+  return "universe";
*** End Patch`,
      });

      assertSuccess<PatchOutput>(result);
      expect(result.files[0].path).toBe("/workspace/src/renamed.ts");

      const files = sandbox.getFiles();
      expect(files["/workspace/src/main.ts"]).toBeUndefined();
      expect(files["/workspace/src/renamed.ts"]).toContain('"universe"');
    });
  });

  describe("allowedPaths", () => {
    it("should block paths outside allowed paths", async () => {
      const tool = createPatchTool(sandbox, {
        allowedPaths: ["/workspace"],
      });

      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Add File: /etc/passwd
+bad content
*** End Patch`,
      });

      assertError(result);
      expect(result.error).toContain("Path not allowed");
    });

    it("should block delete of file outside allowed paths", async () => {
      sandbox.setFile("/etc/config", "secret");
      const tool = createPatchTool(sandbox, {
        allowedPaths: ["/workspace"],
      });

      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Delete File: /etc/config
*** End Patch`,
      });

      assertError(result);
      expect(result.error).toContain("Path not allowed");
    });

    it("should block Move destination outside allowed paths", async () => {
      const tool = createPatchTool(sandbox, {
        allowedPaths: ["/workspace"],
      });

      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Update File: /workspace/src/main.ts
*** Move to: /etc/main.ts
@@
 export function hello() {
-  return "world";
+  return "universe";
*** End Patch`,
      });

      assertError(result);
      expect(result.error).toContain("Path not allowed");
    });

    it("should allow paths within allowed paths", async () => {
      const tool = createPatchTool(sandbox, {
        allowedPaths: ["/workspace"],
      });

      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Update File: /workspace/src/main.ts
@@
 export function hello() {
-  return "world";
+  return "universe";
*** End Patch`,
      });

      assertSuccess<PatchOutput>(result);
    });
  });

  describe("maxFileSize", () => {
    it("should enforce maxFileSize on Add", async () => {
      const tool = createPatchTool(sandbox, {
        maxFileSize: 10,
      });

      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Add File: /workspace/src/big.ts
+this is a very long line that exceeds the limit
*** End Patch`,
      });

      assertError(result);
      expect(result.error).toContain("File too large");
    });

    it("should enforce maxFileSize on Update", async () => {
      const tool = createPatchTool(sandbox, {
        maxFileSize: 10,
      });

      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Update File: /workspace/src/main.ts
@@
 export function hello() {
-  return "world";
+  return "this is a very long replacement that exceeds the file size limit when combined with everything else";
*** End Patch`,
      });

      assertError(result);
      expect(result.error).toContain("File too large");
    });
  });

  describe("Fuzzy whitespace matching", () => {
    it("should match with trailing whitespace differences", async () => {
      sandbox.setFile(
        "/workspace/src/spaces.ts",
        "function test() {  \n  return 42;  \n}\n",
      );

      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Update File: /workspace/src/spaces.ts
@@
 function test() {
-  return 42;
+  return 99;
*** End Patch`,
      });

      assertSuccess<PatchOutput>(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/src/spaces.ts"]).toContain("return 99;");
    });
  });

  describe("Unicode matching (Codex: test_update_line_with_unicode_dash)", () => {
    it("should match ASCII patch against Unicode file content", async () => {
      // Original has EN DASH and NON-BREAKING HYPHEN
      sandbox.setFile(
        "/workspace/src/unicode.py",
        "import asyncio  # local import \u2013 avoids top\u2011level dep\n",
      );

      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Update File: /workspace/src/unicode.py
@@
-import asyncio  # local import - avoids top-level dep
+import asyncio  # HELLO
*** End Patch`,
      });

      assertSuccess<PatchOutput>(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/src/unicode.py"]).toBe(
        "import asyncio  # HELLO\n",
      );
    });
  });

  describe("Error handling", () => {
    it("should return error for invalid patch format", async () => {
      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: "this is not a valid patch",
      });

      assertError(result);
    });

    it("should return error for empty patch", async () => {
      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** End Patch`,
      });

      assertError(result);
      expect(result.error).toContain("no operations");
    });

    it("should handle single file success message", async () => {
      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Delete File: /workspace/src/old.ts
*** End Patch`,
      });

      assertSuccess<PatchOutput>(result);
      expect(result.message).toContain("/workspace/src/old.ts");
      expect(result.message).not.toContain("files");
    });
  });

  describe("Multi-chunk updates with @@ context narrowing", () => {
    it("should apply multiple chunks using change_context to narrow position", async () => {
      const tool = createPatchTool(sandbox);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Update File: /workspace/src/utils.ts
@@ export function add(a: number, b: number) {
-  return a + b;
+  return a + b + 0;
@@ export function sub(a: number, b: number) {
-  return a - b;
+  return a - b - 0;
*** End Patch`,
      });

      assertSuccess<PatchOutput>(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/src/utils.ts"]).toContain("a + b + 0");
      expect(files["/workspace/src/utils.ts"]).toContain("a - b - 0");
    });
  });

  describe("Pre-flight atomicity", () => {
    it("does not apply earlier hunks when a later update has bad context", async () => {
      const originalMain = sandbox.getFiles()["/workspace/src/main.ts"];
      const originalUtils = sandbox.getFiles()["/workspace/src/utils.ts"];
      const tool = createPatchTool(sandbox);

      // Hunk 1 is valid; hunk 2 has a context line that doesn't exist.
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Update File: /workspace/src/main.ts
@@
 export function hello() {
-  return "world";
+  return "universe";
*** Update File: /workspace/src/utils.ts
@@
 export function add(a: number, b: number) {
-  return a + b + nope;
+  return 999;
*** End Patch`,
      });

      assertError(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/src/main.ts"]).toBe(originalMain);
      expect(files["/workspace/src/utils.ts"]).toBe(originalUtils);
    });

    it("does not delete a file when a later add violates maxFileSize", async () => {
      const originalOld = sandbox.getFiles()["/workspace/src/old.ts"];
      const tool = createPatchTool(sandbox, { maxFileSize: 5 });

      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Delete File: /workspace/src/old.ts
*** Add File: /workspace/src/big.ts
+this content is way more than five bytes
*** End Patch`,
      });

      assertError(result);
      const files = sandbox.getFiles();
      expect(files["/workspace/src/old.ts"]).toBe(originalOld);
      expect(files["/workspace/src/big.ts"]).toBeUndefined();
    });
  });

  describe("Move target collision", () => {
    it("errors when the move target already exists", async () => {
      sandbox.setFile("/workspace/src/already-here.ts", "// existing\n");
      const tool = createPatchTool(sandbox);

      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Update File: /workspace/src/main.ts
*** Move to: /workspace/src/already-here.ts
@@
 export function hello() {
-  return "world";
+  return "universe";
*** End Patch`,
      });

      assertError(result);
      expect(result.error).toContain("Move target already exists");

      const files = sandbox.getFiles();
      expect(files["/workspace/src/main.ts"]).toContain('"world"');
      expect(files["/workspace/src/already-here.ts"]).toBe("// existing\n");
    });
  });

  describe("Sandbox method fallbacks", () => {
    it("falls back to exec(rm) when sandbox.deleteFile is undefined", async () => {
      const rmCalls: string[] = [];
      sandbox.setExecHandler((command) => {
        if (command.startsWith("rm -- ")) {
          rmCalls.push(command);
        }
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: 1,
          interrupted: false,
        };
      });

      // Wrap the mock sandbox with deleteFile/rename omitted so the patch tool
      // exercises its exec-based fallback path. The wrapper proxies every other
      // method (including readFile/fileExists/writeFile) to the mock.
      const { deleteFile: _omitDelete, rename: _omitRename, ...rest } = sandbox;
      const sandboxWithoutOptionalMethods: Sandbox = rest;

      const tool = createPatchTool(sandboxWithoutOptionalMethods);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Delete File: /workspace/src/old.ts
*** End Patch`,
      });

      assertSuccess<PatchOutput>(result);
      expect(rmCalls).toEqual(["rm -- '/workspace/src/old.ts'"]);
    });

    it("quotes paths with single quotes when falling back to exec", async () => {
      const tricky = "/workspace/it's a file.ts";
      sandbox.setFile(tricky, "// content\n");

      const rmCalls: string[] = [];
      sandbox.setExecHandler((command) => {
        if (command.startsWith("rm -- ")) rmCalls.push(command);
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: 1,
          interrupted: false,
        };
      });

      const { deleteFile: _omitDelete, rename: _omitRename, ...rest } = sandbox;
      const sandboxWithoutOptionalMethods: Sandbox = rest;

      const tool = createPatchTool(sandboxWithoutOptionalMethods);
      const result = await executeTool(tool, {
        patch: `*** Begin Patch
*** Delete File: ${tricky}
*** End Patch`,
      });

      assertSuccess<PatchOutput>(result);
      expect(rmCalls).toEqual([
        String.raw`rm -- '/workspace/it'\''s a file.ts'`,
      ]);
    });
  });
});
