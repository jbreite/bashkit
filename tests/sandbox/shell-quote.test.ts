import { describe, expect, it } from "vitest";
import { shellQuote } from "@/sandbox/shell-quote";

describe("shellQuote", () => {
  it("wraps a plain string in single quotes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });

  it("wraps an empty string in single quotes", () => {
    expect(shellQuote("")).toBe("''");
  });

  it("escapes embedded single quotes as '\\''", () => {
    expect(shellQuote("it's")).toBe(String.raw`'it'\''s'`);
  });

  it("escapes multiple embedded single quotes", () => {
    expect(shellQuote("a'b'c")).toBe(String.raw`'a'\''b'\''c'`);
  });

  it("preserves dollar signs and backticks (single quotes disable expansion)", () => {
    expect(shellQuote("$HOME")).toBe("'$HOME'");
    expect(shellQuote("`whoami`")).toBe("'`whoami`'");
  });

  it("preserves double quotes (no escaping needed inside single quotes)", () => {
    expect(shellQuote('"quoted"')).toBe(`'"quoted"'`);
  });

  it("preserves whitespace and special characters", () => {
    expect(shellQuote("foo bar/baz qux")).toBe("'foo bar/baz qux'");
    expect(shellQuote("path with newline\nhere")).toBe(
      "'path with newline\nhere'",
    );
  });

  it("handles paths with shell metacharacters safely", () => {
    expect(shellQuote("; rm -rf /")).toBe("'; rm -rf /'");
    expect(shellQuote("&& echo pwned")).toBe("'&& echo pwned'");
  });
});
