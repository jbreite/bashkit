import { describe, it, expect, vi } from "vitest";
import { createOutputPolicy } from "@/context/output-policy";
import { createMockSandbox } from "../helpers";

/** Helper to run afterExecute (handles async) */
async function transform(
  layer: ReturnType<typeof createOutputPolicy>,
  toolName: string,
  params: Record<string, unknown>,
  result: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return await layer.afterExecute!(toolName, params, result);
}

describe("createOutputPolicy", () => {
  // -----------------------------------------------------------------------
  // Basic truncation behavior
  // -----------------------------------------------------------------------

  it("passes through results below redirection threshold", async () => {
    const layer = createOutputPolicy({ redirectionThreshold: 100 });
    const result = { stdout: "short output" };
    const transformed = await transform(layer, "Bash", {}, result);
    expect(transformed).toEqual(result);
  });

  it("truncates results above maxOutputLength", async () => {
    const layer = createOutputPolicy({
      maxOutputLength: 100,
      redirectionThreshold: 50,
    });
    const result = { stdout: "x".repeat(200) };
    const transformed = await transform(layer, "Bash", {}, result);
    expect(typeof transformed.stdout).toBe("string");
    expect((transformed.stdout as string).length).toBeLessThan(200);
    expect(transformed._hint).toBeDefined();
  });

  it("passes through when text equals threshold exactly", async () => {
    const layer = createOutputPolicy({ redirectionThreshold: 20 });
    const result = { stdout: "x".repeat(20) };
    const transformed = await transform(layer, "Bash", {}, result);
    expect(transformed).toEqual(result);
  });

  // -----------------------------------------------------------------------
  // Per-tool hints
  // -----------------------------------------------------------------------

  it("injects Bash-specific redirection hint", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
    });
    const result = { stdout: "x".repeat(100) };
    const transformed = await transform(layer, "Bash", {}, result);
    const hint = transformed._hint as string;
    expect(hint).toContain("head");
    expect(hint).toContain("tail");
    expect(hint).toContain("grep");
  });

  it("injects Read-specific redirection hint", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
    });
    const result = { content: "x".repeat(100) };
    const transformed = await transform(layer, "Read", {}, result);
    const hint = transformed._hint as string;
    expect(hint).toContain("offset");
    expect(hint).toContain("limit");
  });

  it("injects Grep-specific redirection hint", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
    });
    const result = { stdout: "x".repeat(100) };
    const transformed = await transform(layer, "Grep", {}, result);
    const hint = transformed._hint as string;
    expect(hint).toContain("head_limit");
    expect(hint).toContain("offset");
  });

  it("injects generic hint for unknown tools", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
    });
    const result = { stdout: "x".repeat(100) };
    const transformed = await transform(layer, "SqlQuery", {}, result);
    const hint = transformed._hint as string;
    expect(hint).toContain("Read");
    expect(hint).toContain("Grep");
  });

  // -----------------------------------------------------------------------
  // Custom hints map
  // -----------------------------------------------------------------------

  it("custom hints map overrides built-in hints", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
      hints: { Bash: "Custom bash hint" },
    });
    const result = { stdout: "x".repeat(100) };
    const transformed = await transform(layer, "Bash", {}, result);
    expect(transformed._hint).toBe("Custom bash hint");
  });

  it("custom hints map works for external tools", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
      hints: { Research: "Full data on disk. Use Read/Grep." },
    });
    const result = { stdout: "x".repeat(100) };
    const transformed = await transform(layer, "Research", {}, result);
    expect(transformed._hint).toBe("Full data on disk. Use Read/Grep.");
  });

  // -----------------------------------------------------------------------
  // Custom buildHint callback
  // -----------------------------------------------------------------------

  it("buildHint callback overrides all other hints", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
      hints: { Bash: "should not see this" },
      buildHint: (_toolName, _params, len) => `Custom: ${len} chars truncated`,
    });
    const result = { stdout: "x".repeat(100) };
    const transformed = await transform(layer, "Bash", {}, result);
    expect(transformed._hint).toBe("Custom: 100 chars truncated");
  });

  it("buildHint receives result object", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
      buildHint: (toolName, _params, _len, result) => {
        if (toolName === "Research" && "queryHint" in result) {
          return `Data at ${result.file}. ${result.queryHint}`;
        }
        return undefined;
      },
    });
    // Serialize of this will exceed threshold
    const result = {
      file: "/tmp/research/data.jsonl",
      queryHint: "use jq",
      data: "x".repeat(100),
    };
    const transformed = await transform(layer, "Research", {}, result);
    expect(transformed._hint).toBe("Data at /tmp/research/data.jsonl. use jq");
  });

  it("buildHint falls through to hints map when returning undefined", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
      hints: { Bash: "Hints map fallback" },
      buildHint: (toolName) => {
        if (toolName === "Research") return "Research hint";
        return undefined;
      },
    });
    const result = { stdout: "x".repeat(100) };
    const transformed = await transform(layer, "Bash", {}, result);
    expect(transformed._hint).toBe("Hints map fallback");
  });

  // -----------------------------------------------------------------------
  // excludeTools
  // -----------------------------------------------------------------------

  it("excludes tools in excludeTools list", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
      excludeTools: ["Research"],
    });
    const result = { stdout: "x".repeat(100) };
    const transformed = await transform(layer, "Research", {}, result);
    expect(transformed).toEqual(result); // unchanged
  });

  // -----------------------------------------------------------------------
  // Custom truncation function
  // -----------------------------------------------------------------------

  it("uses custom truncation function", async () => {
    const customTruncate = vi.fn(
      (text: string, maxLen: number) => text.slice(0, maxLen) + "...CUSTOM",
    );
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
      truncate: customTruncate,
    });
    const result = { stdout: "x".repeat(100) };
    const transformed = await transform(layer, "Bash", {}, result);
    expect(customTruncate).toHaveBeenCalledWith("x".repeat(100), 50);
    expect((transformed.stdout as string).endsWith("...CUSTOM")).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Structured output handling
  // -----------------------------------------------------------------------

  it("handles objects with stdout field", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
    });
    const result = { stdout: "x".repeat(100), exitCode: 0 };
    const transformed = await transform(layer, "Bash", {}, result);
    expect(typeof transformed.stdout).toBe("string");
    expect(transformed.exitCode).toBe(0); // preserved
    expect(transformed._hint).toBeDefined();
  });

  it("handles objects with content field", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
    });
    const result = { content: "x".repeat(100), lineCount: 50 };
    const transformed = await transform(layer, "Read", {}, result);
    expect(typeof transformed.content).toBe("string");
    expect(transformed.lineCount).toBe(50); // preserved
    expect(transformed._hint).toBeDefined();
  });

  it("handles structured results via JSON serialization", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
    });
    // No stdout or content — falls through to JSON serialization
    const result = { data: "x".repeat(100), total: 42 };
    const transformed = await transform(layer, "Custom", {}, result);
    expect(transformed._truncated).toBeDefined();
    expect(transformed._hint).toBeDefined();
    // Original fields are preserved alongside truncation metadata
    expect(transformed.data).toBe(result.data);
    expect(transformed.total).toBe(42);
  });

  // -----------------------------------------------------------------------
  // stashOutput
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Priority: stdout > content > JSON serialization
  // -----------------------------------------------------------------------

  it("stdout takes priority over content when both present", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
    });
    const result = { stdout: "x".repeat(100), content: "y".repeat(100) };
    const transformed = await transform(layer, "Bash", {}, result);
    // stdout was truncated, content preserved as-is
    expect(typeof transformed.stdout).toBe("string");
    expect((transformed.stdout as string).length).toBeLessThan(100);
    expect(transformed.content).toBe("y".repeat(100));
  });

  // -----------------------------------------------------------------------
  // Error results
  // -----------------------------------------------------------------------

  it("error results pass through when below threshold", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 200, // high enough for serialized error
      maxOutputLength: 300,
    });
    const result = { error: "something went wrong" };
    const transformed = await transform(layer, "Bash", {}, result);
    expect(transformed).toEqual(result);
  });

  it("large error results preserve error field after truncation", async () => {
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
    });
    // Error with a very large message — serialized JSON exceeds threshold
    const result = { error: "x".repeat(100) };
    const transformed = await transform(layer, "Bash", {}, result);
    expect(transformed._hint).toBeDefined();
    // The error field must survive so models can reason about the failure
    expect(transformed.error).toBe(result.error);
  });

  // -----------------------------------------------------------------------
  // stashOutput + hint combinations
  // -----------------------------------------------------------------------

  it("stashOutput + hints map: file path prepended to custom hint", async () => {
    const sandbox = createMockSandbox();
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
      hints: { Bash: "Re-run with | head" },
      stashOutput: {
        sandbox,
        tools: ["Bash"],
      },
    });

    const result = { stdout: "x".repeat(100) };
    const transformed = await transform(layer, "Bash", {}, result);
    const hint = transformed._hint as string;
    expect(hint).toContain("Full output saved to");
    expect(hint).toContain("Re-run with | head");
  });

  it("stashOutput + buildHint: file path prepended to callback hint", async () => {
    const sandbox = createMockSandbox();
    const layer = createOutputPolicy({
      redirectionThreshold: 10,
      maxOutputLength: 50,
      buildHint: () => "Custom callback hint",
      stashOutput: {
        sandbox,
        tools: ["Bash"],
      },
    });

    const result = { stdout: "x".repeat(100) };
    const transformed = await transform(layer, "Bash", {}, result);
    const hint = transformed._hint as string;
    expect(hint).toContain("Full output saved to");
    expect(hint).toContain("Custom callback hint");
  });

  // -----------------------------------------------------------------------
  // stashOutput
  // -----------------------------------------------------------------------

  describe("stashOutput", () => {
    it("writes full result to disk before truncating", async () => {
      const sandbox = createMockSandbox();
      const layer = createOutputPolicy({
        redirectionThreshold: 10,
        maxOutputLength: 50,
        stashOutput: {
          sandbox,
          tools: ["Bash"],
        },
      });

      const result = { stdout: "x".repeat(100) };
      const transformed = await transform(layer, "Bash", {}, result);

      // File was written
      const files = sandbox.getFiles();
      const paths = Object.keys(files);
      const stashPath = paths.find((p) =>
        p.startsWith("/tmp/.bashkit/tool-output/Bash-"),
      );
      expect(stashPath).toBeDefined();
      expect(files[stashPath!]).toBe("x".repeat(100));

      // Hint includes file path
      expect(transformed._hint).toContain(stashPath!);
    });

    it("hint includes stash file path", async () => {
      const sandbox = createMockSandbox();
      const layer = createOutputPolicy({
        redirectionThreshold: 10,
        maxOutputLength: 50,
        stashOutput: {
          sandbox,
          tools: ["Bash"],
        },
      });

      const result = { stdout: "x".repeat(100) };
      const transformed = await transform(layer, "Bash", {}, result);
      expect(transformed._hint as string).toContain("Full output saved to");
    });

    it("does not write for tools not in the tools list", async () => {
      const sandbox = createMockSandbox();
      const layer = createOutputPolicy({
        redirectionThreshold: 10,
        maxOutputLength: 50,
        stashOutput: {
          sandbox,
          tools: ["Bash"],
        },
      });

      const result = { stdout: "x".repeat(100) };
      await transform(layer, "Grep", {}, result);

      const files = sandbox.getFiles();
      const stashPaths = Object.keys(files).filter((p) =>
        p.startsWith("/tmp/.bashkit/tool-output/"),
      );
      expect(stashPaths).toHaveLength(0);
    });

    it("creates dir via mkdir -p", async () => {
      const sandbox = createMockSandbox();
      const layer = createOutputPolicy({
        redirectionThreshold: 10,
        maxOutputLength: 50,
        stashOutput: {
          sandbox,
          tools: ["Bash"],
        },
      });

      const result = { stdout: "x".repeat(100) };
      await transform(layer, "Bash", {}, result);

      const history = sandbox.getExecHistory();
      expect(history.some((e) => e.command.includes("mkdir -p"))).toBe(true);
    });

    it("does not write when output is below threshold", async () => {
      const sandbox = createMockSandbox();
      const layer = createOutputPolicy({
        redirectionThreshold: 200,
        maxOutputLength: 300,
        stashOutput: {
          sandbox,
          tools: ["Bash"],
        },
      });

      const result = { stdout: "short" };
      const transformed = await transform(layer, "Bash", {}, result);

      expect(transformed).toEqual(result); // unchanged
      const files = sandbox.getFiles();
      expect(
        Object.keys(files).filter((p) =>
          p.startsWith("/tmp/.bashkit/tool-output/"),
        ),
      ).toHaveLength(0);
    });

    it("pathFor uses custom path when provided", async () => {
      const sandbox = createMockSandbox();
      const layer = createOutputPolicy({
        redirectionThreshold: 10,
        maxOutputLength: 50,
        stashOutput: {
          sandbox,
          tools: ["Research"],
          pathFor: (toolName, _params, result) => {
            if (toolName === "Research" && "kind" in result) {
              return `/tmp/research/${String(result.kind)}.jsonl`;
            }
            return undefined;
          },
        },
      });

      const result = { stdout: "x".repeat(100), kind: "search_messages" };
      await transform(layer, "Research", {}, result);

      const files = sandbox.getFiles();
      expect(files["/tmp/research/search_messages.jsonl"]).toBeDefined();
    });

    it("pathFor falls back to default when returning undefined", async () => {
      const sandbox = createMockSandbox();
      const layer = createOutputPolicy({
        redirectionThreshold: 10,
        maxOutputLength: 50,
        stashOutput: {
          sandbox,
          tools: ["Bash"],
          pathFor: () => undefined,
        },
      });

      const result = { stdout: "x".repeat(100) };
      await transform(layer, "Bash", {}, result);

      const files = sandbox.getFiles();
      const stashPath = Object.keys(files).find((p) =>
        p.startsWith("/tmp/.bashkit/tool-output/Bash-"),
      );
      expect(stashPath).toBeDefined();
    });

    it("uses custom stash dir", async () => {
      const sandbox = createMockSandbox();
      const layer = createOutputPolicy({
        redirectionThreshold: 10,
        maxOutputLength: 50,
        stashOutput: {
          sandbox,
          dir: "/custom/output",
          tools: ["Bash"],
        },
      });

      const result = { stdout: "x".repeat(100) };
      await transform(layer, "Bash", {}, result);

      const files = sandbox.getFiles();
      const stashPath = Object.keys(files).find((p) =>
        p.startsWith("/custom/output/Bash-"),
      );
      expect(stashPath).toBeDefined();
    });
  });
});
