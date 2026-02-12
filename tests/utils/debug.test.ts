import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  debugStart,
  debugEnd,
  debugError,
  isDebugEnabled,
  getDebugLogs,
  clearDebugLogs,
  reinitDebugMode,
  runWithDebugParent,
  summarize,
} from "@/utils/debug";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set debug mode and reinitialize */
function setDebugMode(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.BASHKIT_DEBUG;
  } else {
    process.env.BASHKIT_DEBUG = value;
  }
  reinitDebugMode();
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

describe("debug", () => {
  const originalEnv = process.env.BASHKIT_DEBUG;

  beforeEach(() => {
    setDebugMode("memory");
  });

  afterEach(() => {
    clearDebugLogs();
    if (originalEnv === undefined) {
      delete process.env.BASHKIT_DEBUG;
    } else {
      process.env.BASHKIT_DEBUG = originalEnv;
    }
    reinitDebugMode();
  });

  // -------------------------------------------------------------------------
  // isDebugEnabled
  // -------------------------------------------------------------------------

  describe("isDebugEnabled", () => {
    it("returns true when debug mode is on", () => {
      setDebugMode("memory");
      expect(isDebugEnabled()).toBe(true);
    });

    it("returns true for stderr mode", () => {
      setDebugMode("stderr");
      expect(isDebugEnabled()).toBe(true);
    });

    it("returns true for '1'", () => {
      setDebugMode("1");
      expect(isDebugEnabled()).toBe(true);
    });

    it("returns true for json mode", () => {
      setDebugMode("json");
      expect(isDebugEnabled()).toBe(true);
    });

    it("returns false when debug mode is off", () => {
      setDebugMode(undefined);
      expect(isDebugEnabled()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // debugStart
  // -------------------------------------------------------------------------

  describe("debugStart", () => {
    it("returns an event ID", () => {
      const id = debugStart("bash", { command: "echo hello" });
      expect(id).toMatch(/^bash-\d+$/);
    });

    it("returns empty string when debug is off", () => {
      setDebugMode(undefined);
      const id = debugStart("bash", { command: "echo hello" });
      expect(id).toBe("");
    });

    it("emits a start event to memory logs", () => {
      const id = debugStart("bash", { command: "echo hello" });
      const logs = getDebugLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        id,
        tool: "bash",
        event: "start",
        input: { command: "echo hello" },
      });
    });

    it("increments IDs for the same tool", () => {
      const id1 = debugStart("bash");
      const id2 = debugStart("bash");
      expect(id1).not.toBe(id2);

      const num1 = parseInt(id1.split("-")[1]);
      const num2 = parseInt(id2.split("-")[1]);
      expect(num2).toBe(num1 + 1);
    });

    it("tracks separate counters per tool", () => {
      const bashId = debugStart("bash");
      const grepId = debugStart("grep");

      expect(bashId).toMatch(/^bash-\d+$/);
      expect(grepId).toMatch(/^grep-\d+$/);
    });

    it("includes timestamp", () => {
      const before = Date.now();
      debugStart("bash");
      const after = Date.now();

      const logs = getDebugLogs();
      expect(logs[0].ts).toBeGreaterThanOrEqual(before);
      expect(logs[0].ts).toBeLessThanOrEqual(after);
    });

    it("has no parent when not inside runWithDebugParent", () => {
      debugStart("bash");
      const logs = getDebugLogs();
      expect(logs[0].parent).toBeUndefined();
    });

    it("summarizes input data", () => {
      const longString = "x".repeat(2000);
      debugStart("bash", { command: longString });
      const logs = getDebugLogs();
      const input = logs[0].input as Record<string, string>;
      expect(input.command.length).toBeLessThan(longString.length);
      expect(input.command).toContain("[truncated");
    });
  });

  // -------------------------------------------------------------------------
  // debugEnd
  // -------------------------------------------------------------------------

  describe("debugEnd", () => {
    it("emits an end event", () => {
      const id = debugStart("bash");
      debugEnd(id, "bash", { duration_ms: 42 });

      const logs = getDebugLogs();
      expect(logs).toHaveLength(2);
      expect(logs[1]).toMatchObject({
        id,
        tool: "bash",
        event: "end",
        duration_ms: 42,
      });
    });

    it("includes summary data", () => {
      const id = debugStart("grep");
      debugEnd(id, "grep", {
        summary: { matchCount: 5, fileCount: 3 },
        duration_ms: 10,
      });

      const logs = getDebugLogs();
      expect(logs[1].summary).toEqual({ matchCount: 5, fileCount: 3 });
    });

    it("includes summarized output", () => {
      const id = debugStart("bash");
      debugEnd(id, "bash", {
        output: { stdout: "hello world" },
        duration_ms: 5,
      });

      const logs = getDebugLogs();
      expect(logs[1].output).toEqual({ stdout: "hello world" });
    });

    it("does nothing when debug is off", () => {
      setDebugMode("memory");
      const id = debugStart("bash");
      setDebugMode(undefined);
      debugEnd(id, "bash", { duration_ms: 10 });

      // Only the start event should be in logs (from before mode was turned off)
      // Actually reinitDebugMode clears logs, so there should be 0
      const logs = getDebugLogs();
      expect(logs).toHaveLength(0);
    });

    it("does nothing with empty id", () => {
      debugEnd("", "bash", { duration_ms: 10 });
      const logs = getDebugLogs();
      expect(logs).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // debugError
  // -------------------------------------------------------------------------

  describe("debugError", () => {
    it("emits an error event with string message", () => {
      const id = debugStart("bash");
      debugError(id, "bash", "command not found");

      const logs = getDebugLogs();
      expect(logs).toHaveLength(2);
      expect(logs[1]).toMatchObject({
        id,
        tool: "bash",
        event: "error",
        error: "command not found",
      });
    });

    it("emits an error event with Error object", () => {
      const id = debugStart("bash");
      debugError(id, "bash", new Error("timeout exceeded"));

      const logs = getDebugLogs();
      expect(logs[1].error).toBe("timeout exceeded");
    });

    it("does nothing when debug is off", () => {
      setDebugMode(undefined);
      debugError("fake-id", "bash", "some error");
      // No crash, no logs
    });

    it("does nothing with empty id", () => {
      debugError("", "bash", "some error");
      const logs = getDebugLogs();
      expect(logs).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // runWithDebugParent
  // -------------------------------------------------------------------------

  describe("runWithDebugParent", () => {
    it("sets parent on child debug events", () => {
      const parentId = debugStart("task");

      runWithDebugParent(parentId, () => {
        debugStart("bash", { command: "ls" });
      });

      const logs = getDebugLogs();
      const childEvent = logs.find(
        (e) => e.tool === "bash" && e.event === "start",
      );
      expect(childEvent?.parent).toBe(parentId);
    });

    it("works with async functions", async () => {
      const parentId = debugStart("task");

      await runWithDebugParent(parentId, async () => {
        await new Promise((r) => setTimeout(r, 5));
        debugStart("bash", { command: "ls" });
      });

      const logs = getDebugLogs();
      const childEvent = logs.find(
        (e) => e.tool === "bash" && e.event === "start",
      );
      expect(childEvent?.parent).toBe(parentId);
    });

    it("returns the function's return value", () => {
      const result = runWithDebugParent("parent-1", () => 42);
      expect(result).toBe(42);
    });

    it("returns a promise for async functions", async () => {
      const result = await runWithDebugParent("parent-1", async () => "hello");
      expect(result).toBe("hello");
    });

    it("does not set parent on events outside the context", () => {
      const parentId = debugStart("task");

      runWithDebugParent(parentId, () => {
        debugStart("bash", { command: "inside" });
      });

      // This event is outside the context
      debugStart("grep", { pattern: "outside" });

      const logs = getDebugLogs();
      const insideEvent = logs.find((e) => e.tool === "bash");
      const outsideEvent = logs.find((e) => e.tool === "grep");

      expect(insideEvent?.parent).toBe(parentId);
      expect(outsideEvent?.parent).toBeUndefined();
    });

    it("supports nested parent contexts", () => {
      const outerParent = debugStart("task");

      runWithDebugParent(outerParent, () => {
        const innerParent = debugStart("task");

        runWithDebugParent(innerParent, () => {
          debugStart("bash", { command: "nested" });
        });
      });

      const logs = getDebugLogs();
      const bashEvent = logs.find((e) => e.tool === "bash");
      const innerTaskEvent = logs.find(
        (e) => e.tool === "task" && e.id !== outerParent,
      );

      // Bash's parent should be the inner task
      expect(bashEvent?.parent).toBe(innerTaskEvent?.id);
      // Inner task's parent should be the outer task
      expect(innerTaskEvent?.parent).toBe(outerParent);
    });

    it("isolates parallel execution contexts", async () => {
      const [idA, idB] = await Promise.all([
        runWithDebugParent("parent-A", async () => {
          // Delay to force interleaving
          await new Promise((r) => setTimeout(r, 10));
          return debugStart("bash", { command: "from A" });
        }),
        runWithDebugParent("parent-B", async () => {
          return debugStart("grep", { pattern: "from B" });
        }),
      ]);

      const logs = getDebugLogs();
      const eventA = logs.find((e) => e.id === idA);
      const eventB = logs.find((e) => e.id === idB);

      expect(eventA?.parent).toBe("parent-A");
      expect(eventB?.parent).toBe("parent-B");
    });

    it("isolates many parallel contexts", async () => {
      const count = 20;
      const parentIds = Array.from({ length: count }, (_, i) => `parent-${i}`);

      const childIds = await Promise.all(
        parentIds.map((parentId, i) =>
          runWithDebugParent(parentId, async () => {
            // Stagger to create interleaving
            await new Promise((r) => setTimeout(r, Math.random() * 10));
            return debugStart("tool", { index: i });
          }),
        ),
      );

      const logs = getDebugLogs();

      for (let i = 0; i < count; i++) {
        const event = logs.find((e) => e.id === childIds[i]);
        expect(event?.parent).toBe(parentIds[i]);
      }
    });

    it("skips wrapping when debug is off", () => {
      setDebugMode(undefined);
      let called = false;
      const result = runWithDebugParent("some-parent", () => {
        called = true;
        return "value";
      });
      expect(called).toBe(true);
      expect(result).toBe("value");
    });

    it("skips wrapping when parentId is empty", () => {
      const result = runWithDebugParent("", () => "value");
      expect(result).toBe("value");
      // No parent should be set
      debugStart("bash");
      const logs = getDebugLogs();
      expect(logs[0].parent).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // summarize
  // -------------------------------------------------------------------------

  describe("summarize", () => {
    it("passes through short strings", () => {
      expect(summarize("hello")).toBe("hello");
    });

    it("truncates long strings", () => {
      const long = "x".repeat(2000);
      const result = summarize(long) as string;
      expect(result.length).toBeLessThan(long.length);
      expect(result).toContain("[truncated");
    });

    it("passes through numbers", () => {
      expect(summarize(42)).toBe(42);
    });

    it("passes through booleans", () => {
      expect(summarize(true)).toBe(true);
      expect(summarize(false)).toBe(false);
    });

    it("passes through null and undefined", () => {
      expect(summarize(null)).toBeNull();
      expect(summarize(undefined)).toBeUndefined();
    });

    it("truncates long arrays", () => {
      const arr = Array.from({ length: 20 }, (_, i) => i);
      const result = summarize(arr) as unknown[];
      expect(result.length).toBe(11); // 10 items + truncation message
      expect(result[10]).toContain("10 more items");
    });

    it("keeps short arrays intact", () => {
      const arr = [1, 2, 3];
      expect(summarize(arr)).toEqual([1, 2, 3]);
    });

    it("recursively summarizes objects", () => {
      const obj = { name: "test", value: "x".repeat(2000) };
      const result = summarize(obj) as Record<string, string>;
      expect(result.name).toBe("test");
      expect(result.value).toContain("[truncated");
    });

    it("limits recursion depth", () => {
      const deep = { a: { b: { c: { d: { e: { f: { g: "deep" } } } } } } };
      const result = summarize(deep) as any;
      expect(result.a.b.c.d.e.f).toBe("[nested object]");
    });

    it("converts unknown types to string", () => {
      expect(summarize(Symbol("test"))).toBe("Symbol(test)");
    });
  });

  // -------------------------------------------------------------------------
  // getDebugLogs / clearDebugLogs
  // -------------------------------------------------------------------------

  describe("getDebugLogs", () => {
    it("returns empty array initially", () => {
      clearDebugLogs();
      expect(getDebugLogs()).toEqual([]);
    });

    it("returns a copy (not the internal array)", () => {
      debugStart("bash");
      const logs1 = getDebugLogs();
      const logs2 = getDebugLogs();
      expect(logs1).not.toBe(logs2);
      expect(logs1).toEqual(logs2);
    });

    it("accumulates events", () => {
      debugStart("bash");
      debugStart("grep");
      debugStart("read");
      expect(getDebugLogs()).toHaveLength(3);
    });
  });

  describe("clearDebugLogs", () => {
    it("clears all logs", () => {
      debugStart("bash");
      debugStart("grep");
      expect(getDebugLogs()).toHaveLength(2);

      clearDebugLogs();
      expect(getDebugLogs()).toHaveLength(0);
    });

    it("resets counters", () => {
      debugStart("bash"); // bash-1
      debugStart("bash"); // bash-2
      clearDebugLogs();

      const id = debugStart("bash"); // should be bash-1 again
      expect(id).toMatch(/^bash-1$/);
    });
  });

  // -------------------------------------------------------------------------
  // reinitDebugMode
  // -------------------------------------------------------------------------

  describe("reinitDebugMode", () => {
    it("reinitializes from environment", () => {
      setDebugMode(undefined);
      expect(isDebugEnabled()).toBe(false);

      process.env.BASHKIT_DEBUG = "memory";
      reinitDebugMode();
      expect(isDebugEnabled()).toBe(true);
    });

    it("clears logs on reinit", () => {
      debugStart("bash");
      expect(getDebugLogs()).toHaveLength(1);

      reinitDebugMode();
      expect(getDebugLogs()).toHaveLength(0);
    });

    it("defaults to stderr for unrecognized values", () => {
      process.env.BASHKIT_DEBUG = "unknown-value";
      reinitDebugMode();
      expect(isDebugEnabled()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // stderr / json output modes
  // -------------------------------------------------------------------------

  describe("stderr output mode", () => {
    it("writes human-readable output to stderr", () => {
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      setDebugMode("stderr");
      const id = debugStart("bash", { command: "echo hi" });
      debugEnd(id, "bash", { duration_ms: 5 });

      expect(stderrSpy).toHaveBeenCalledTimes(2);

      const startCall = stderrSpy.mock.calls[0][0] as string;
      expect(startCall).toContain("[bashkit:bash]");
      expect(startCall).toContain("→");

      const endCall = stderrSpy.mock.calls[1][0] as string;
      expect(endCall).toContain("[bashkit:bash]");
      expect(endCall).toContain("←");
      expect(endCall).toContain("5ms");

      stderrSpy.mockRestore();
    });

    it("writes error output to stderr", () => {
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      setDebugMode("stderr");
      const id = debugStart("bash");
      debugError(id, "bash", "command failed");

      const errorCall = stderrSpy.mock.calls[1][0] as string;
      expect(errorCall).toContain("✗");
      expect(errorCall).toContain("command failed");

      stderrSpy.mockRestore();
    });
  });

  describe("json output mode", () => {
    it("writes JSON lines to stderr", () => {
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      setDebugMode("json");
      debugStart("bash", { command: "echo hi" });

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.tool).toBe("bash");
      expect(parsed.event).toBe("start");

      stderrSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Human-readable indentation with runWithDebugParent
  // -------------------------------------------------------------------------

  describe("stderr indentation with parent context", () => {
    it("indents child events in human-readable mode", () => {
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      setDebugMode("stderr");
      const parentId = debugStart("task");

      runWithDebugParent(parentId, () => {
        debugStart("bash", { command: "ls" });
      });

      // First call: task start (no indent)
      const taskStart = stderrSpy.mock.calls[0][0] as string;
      expect(taskStart).toMatch(/^\[bashkit:task\]/);

      // Second call: bash start (indented)
      const bashStart = stderrSpy.mock.calls[1][0] as string;
      expect(bashStart).toMatch(/^ {2}\[bashkit:bash\]/);

      stderrSpy.mockRestore();
    });
  });
});
