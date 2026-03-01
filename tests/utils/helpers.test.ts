import { describe, it, expect } from "vitest";
import { middleTruncate } from "@/utils/helpers";

describe("middleTruncate", () => {
  it("should return text unchanged when shorter than maxLength", () => {
    const text = "hello world";
    expect(middleTruncate(text, 100)).toBe(text);
  });

  it("should return text unchanged when exactly at maxLength", () => {
    const text = "x".repeat(1000);
    expect(middleTruncate(text, 1000)).toBe(text);
  });

  it("should preserve first 50% and last 50% of content", () => {
    const text = "A".repeat(500) + "B".repeat(500);
    const result = middleTruncate(text, 100);

    // Head: first 50 chars (all A's)
    expect(result).toContain("A".repeat(50));
    // Tail: last 50 chars (all B's)
    expect(result).toContain("B".repeat(50));
  });

  it("should show correct omitted char count in marker", () => {
    const text = "x".repeat(1000);
    const result = middleTruncate(text, 100);

    // 1000 total - 50 head - 50 tail = 900 omitted
    expect(result).toContain("…900 chars truncated…");
  });

  it("should prepend total output lines header when truncating", () => {
    const text = "line1\nline2\nline3\n" + "x".repeat(1000);
    const result = middleTruncate(text, 100);

    // 4 lines total (3 newlines = 4 lines)
    expect(result).toMatch(/^\[Total output lines: \d+\]/);
  });

  it("should work correctly with multi-line content", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
    const text = lines.join("\n");
    const result = middleTruncate(text, 500);

    expect(result).toContain("[Total output lines: 200]");
    expect(result).toContain("chars truncated");
    // Should contain beginning lines
    expect(result).toContain("line 1");
    // Should contain ending lines
    expect(result).toContain("line 200");
  });

  it("should handle odd maxLength correctly", () => {
    const text = "x".repeat(100);
    const result = middleTruncate(text, 51);

    // head = floor(51/2) = 25, tail = 51 - 25 = 26
    // omitted = 100 - 25 - 26 = 49
    expect(result).toContain("…49 chars truncated…");
  });

  it("should return text unchanged for negative maxLength", () => {
    const text = "hello world";
    expect(middleTruncate(text, -1)).toBe(text);
    expect(middleTruncate(text, -100)).toBe(text);
  });

  it("should return text unchanged for NaN maxLength", () => {
    const text = "hello world";
    expect(middleTruncate(text, NaN)).toBe(text);
  });

  it("should return text unchanged for Infinity maxLength", () => {
    const text = "hello world";
    expect(middleTruncate(text, Infinity)).toBe(text);
  });
});
