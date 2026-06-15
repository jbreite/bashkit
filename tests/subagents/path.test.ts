import { describe, expect, it } from "vitest";
import { normalizeSubagentPath, resolveSubagentPath } from "@/subagents/path";

describe("subagent paths", () => {
  it("normalizes path segments", () => {
    expect(normalizeSubagentPath(" research/./auth ")).toBe("research/auth");
  });

  it("rejects absolute paths", () => {
    expect(normalizeSubagentPath("/research")).toEqual({
      error:
        "task_name must be a relative path without leading or trailing slash",
    });
  });

  it("rejects invalid segments", () => {
    expect(normalizeSubagentPath("research/auth token")).toEqual({
      error:
        "task_name segments may only contain letters, numbers, dots, underscores, and dashes",
    });
  });

  it("resolves relative references from the current path", () => {
    expect(
      resolveSubagentPath("../verify", { currentPath: "research/auth" }),
    ).toBe("research/verify");
  });
});
