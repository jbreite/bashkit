/**
 * Fuzzy line matching for Patch tool.
 * Faithful port of Codex codex-rs/apply-patch/src/seek_sequence.rs
 *
 * Four-tier matching in 4 separate passes (matching Codex exactly):
 * 1. Exact match (all positions)
 * 2. Trailing whitespace trimmed (all positions)
 * 3. Both sides trimmed (all positions)
 * 4. Unicode normalization (all positions)
 *
 * An exact match at a later position is preferred over a fuzzy match at an
 * earlier position — this matches Codex's global tier priority.
 */

/** Map of typographic characters to their ASCII equivalents */
const UNICODE_REPLACEMENTS: [RegExp, string][] = [
  // Dashes: \u2010–\u2015, \u2212 → -
  [/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-"],
  // Single quotes: \u2018–\u201B → '
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  // Double quotes: \u201C–\u201F → "
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  // Non-breaking and other special spaces → regular space
  [/[\u00A0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000]/g, " "],
];

/**
 * Normalize Unicode typographic characters to ASCII equivalents,
 * then trim whitespace.
 */
export function normalizeUnicode(s: string): string {
  let result = s.trim();
  for (const [pattern, replacement] of UNICODE_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Seek a sequence of pattern lines within the file lines.
 * Faithful port of Codex seek_sequence.rs.
 *
 * When `eof` is true, searching starts from the end-of-file position
 * (so patterns intended to match file endings are applied at the end).
 *
 * Returns the index in `lines` where the pattern starts, or null if not found.
 *
 * @param lines - The file lines to search within
 * @param pattern - The pattern lines to find
 * @param start - Starting index in lines to begin search
 * @param eof - If true, search starts from end-of-file position
 */
export function seekSequence(
  lines: string[],
  pattern: string[],
  start: number,
  eof: boolean,
): number | null {
  if (pattern.length === 0) {
    return start;
  }

  // Pattern longer than available input → no possible match
  if (pattern.length > lines.length) {
    return null;
  }

  const searchStart =
    eof && lines.length >= pattern.length
      ? lines.length - pattern.length
      : start;

  const maxIdx = lines.length - pattern.length;

  // Pass 1: Exact match
  for (let i = searchStart; i <= maxIdx; i++) {
    let ok = true;
    for (let j = 0; j < pattern.length; j++) {
      if (lines[i + j] !== pattern[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }

  // Pass 2: Trailing whitespace trimmed (trimEnd)
  for (let i = searchStart; i <= maxIdx; i++) {
    let ok = true;
    for (let j = 0; j < pattern.length; j++) {
      if (lines[i + j].trimEnd() !== pattern[j].trimEnd()) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }

  // Pass 3: Both sides trimmed (trim)
  for (let i = searchStart; i <= maxIdx; i++) {
    let ok = true;
    for (let j = 0; j < pattern.length; j++) {
      if (lines[i + j].trim() !== pattern[j].trim()) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }

  // Pass 4: Unicode normalization
  for (let i = searchStart; i <= maxIdx; i++) {
    let ok = true;
    for (let j = 0; j < pattern.length; j++) {
      if (normalizeUnicode(lines[i + j]) !== normalizeUnicode(pattern[j])) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }

  return null;
}
