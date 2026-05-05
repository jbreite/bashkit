/**
 * Parser for the Codex apply-patch format.
 * Faithful port of Codex codex-rs/apply-patch/src/parser.rs
 */

import {
  PatchParseError,
  type AddFileHunk,
  type DeleteFileHunk,
  type Hunk,
  type ParsedPatch,
  type UpdateFileChunk,
  type UpdateFileHunk,
} from "./types";

const BEGIN_MARKER = "*** Begin Patch";
const END_MARKER = "*** End Patch";
const ADD_PREFIX = "*** Add File: ";
const DELETE_PREFIX = "*** Delete File: ";
const UPDATE_PREFIX = "*** Update File: ";
const MOVE_TO_PREFIX = "*** Move to: ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";
const CHANGE_CONTEXT_PREFIX = "@@ ";
const EOF_MARKER = "*** End of File";

/**
 * Check that lines[0] is Begin marker and lines[last] is End marker (trimmed).
 * Returns true if valid.
 */
function checkPatchBoundariesStrict(lines: string[]): boolean {
  if (lines.length < 2) return false;
  return (
    lines[0].trim() === BEGIN_MARKER &&
    lines[lines.length - 1].trim() === END_MARKER
  );
}

/**
 * Attempt lenient parsing: strip heredoc wrapper (<<EOF / <<'EOF' / <<"EOF")
 * and re-check strict boundaries.
 * Returns the inner lines (without heredoc markers) or null.
 */
function checkPatchBoundariesLenient(lines: string[]): string[] | null {
  if (lines.length < 4) return null;
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (
    (first === "<<EOF" || first === "<<'EOF'" || first === '<<"EOF"') &&
    last.endsWith("EOF")
  ) {
    const inner = lines.slice(1, lines.length - 1);
    if (checkPatchBoundariesStrict(inner)) {
      return inner;
    }
  }
  return null;
}

/**
 * Parse a complete patch string into a ParsedPatch.
 * Supports optional heredoc wrapping (<<'EOF'...EOF).
 * Matches Codex lenient parsing mode.
 */
export function parsePatch(patch: string): ParsedPatch {
  const rawLines = patch.trim().split("\n");

  let lines: string[];
  if (checkPatchBoundariesStrict(rawLines)) {
    lines = rawLines;
  } else {
    const lenient = checkPatchBoundariesLenient(rawLines);
    if (lenient) {
      lines = lenient;
    } else {
      // Check which marker is missing for a better error message
      if (rawLines.length > 0 && rawLines[0].trim() !== BEGIN_MARKER) {
        throw new PatchParseError(
          "The first line of the patch must be '*** Begin Patch'",
        );
      }
      throw new PatchParseError(
        "The last line of the patch must be '*** End Patch'",
      );
    }
  }

  // lines[0] is Begin marker, lines[last] is End marker
  const lastLineIndex = lines.length - 1;
  let remaining = lines.slice(1, lastLineIndex);
  let lineNumber = 2; // 1-indexed, line 1 is Begin marker
  const hunks: Hunk[] = [];

  while (remaining.length > 0) {
    const { hunk, linesConsumed } = parseOneHunk(remaining, lineNumber);
    hunks.push(hunk);
    lineNumber += linesConsumed;
    remaining = remaining.slice(linesConsumed);
  }

  return { hunks };
}

/**
 * Parse a single hunk starting at the beginning of `lines`.
 * Returns the parsed hunk and number of lines consumed.
 */
function parseOneHunk(
  lines: string[],
  lineNumber: number,
): { hunk: Hunk; linesConsumed: number } {
  const firstLine = lines[0].trim();

  if (firstLine.startsWith(ADD_PREFIX.trim())) {
    return parseAddFileHunk(lines, lineNumber);
  }
  if (firstLine.startsWith(DELETE_PREFIX.trim())) {
    return parseDeleteFileHunk(lines, lineNumber);
  }
  if (firstLine.startsWith(UPDATE_PREFIX.trim())) {
    return parseUpdateFileHunk(lines, lineNumber);
  }

  throw new PatchParseError(
    `'${firstLine}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
    lineNumber,
  );
}

/**
 * Parse an Add File hunk. Codex: only `+` prefixed lines are content.
 */
function parseAddFileHunk(
  lines: string[],
  lineNumber: number,
): { hunk: AddFileHunk; linesConsumed: number } {
  const path = lines[0].trim().slice(ADD_PREFIX.trim().length).trim();
  if (!path) {
    throw new PatchParseError("Add File hunk has empty path", lineNumber);
  }

  let contents = "";
  let parsedLines = 1;

  for (const addLine of lines.slice(1)) {
    if (addLine.startsWith("+")) {
      contents += `${addLine.slice(1)}\n`;
      parsedLines++;
    } else {
      break;
    }
  }

  return {
    hunk: { type: "add", path, content: contents },
    linesConsumed: parsedLines,
  };
}

/**
 * Parse a Delete File hunk. Just the header line.
 */
function parseDeleteFileHunk(
  lines: string[],
  lineNumber: number,
): { hunk: DeleteFileHunk; linesConsumed: number } {
  const path = lines[0].trim().slice(DELETE_PREFIX.trim().length).trim();
  if (!path) {
    throw new PatchParseError("Delete File hunk has empty path", lineNumber);
  }

  return {
    hunk: { type: "delete", path },
    linesConsumed: 1,
  };
}

/**
 * Parse an Update File hunk with one or more chunks.
 * Faithful port of Codex parse_one_hunk for UpdateFile.
 */
function parseUpdateFileHunk(
  lines: string[],
  lineNumber: number,
): { hunk: UpdateFileHunk; linesConsumed: number } {
  const path = lines[0].trim().slice(UPDATE_PREFIX.trim().length).trim();
  if (!path) {
    throw new PatchParseError("Update File hunk has empty path", lineNumber);
  }

  let remaining = lines.slice(1);
  let parsedLines = 1;

  // Optional: Move to header
  let movePath: string | undefined;
  if (remaining.length > 0 && remaining[0].startsWith(MOVE_TO_PREFIX)) {
    movePath = remaining[0].slice(MOVE_TO_PREFIX.length).trim();
    remaining = remaining.slice(1);
    parsedLines++;
  }

  const chunks: UpdateFileChunk[] = [];

  while (remaining.length > 0) {
    // Skip blank lines between chunks (Codex: skip completely blank lines)
    if (remaining[0].trim() === "") {
      parsedLines++;
      remaining = remaining.slice(1);
      continue;
    }

    // Stop at next hunk header (*** prefix that isn't End of File or Move to)
    if (remaining[0].startsWith("***")) {
      break;
    }

    const { chunk, linesConsumed } = parseUpdateFileChunk(
      remaining,
      lineNumber + parsedLines,
      chunks.length === 0, // allow_missing_context for first chunk
    );
    chunks.push(chunk);
    parsedLines += linesConsumed;
    remaining = remaining.slice(linesConsumed);
  }

  if (chunks.length === 0) {
    throw new PatchParseError(
      `Update file hunk for path '${path}' is empty`,
      lineNumber,
    );
  }

  return {
    hunk: { type: "update", path, movePath, chunks },
    linesConsumed: parsedLines,
  };
}

/**
 * Parse a single update chunk.
 * Faithful port of Codex parse_update_file_chunk.
 *
 * In Codex:
 * - `@@` or `@@ text` → change_context (single string or null)
 * - Space-prefixed lines go into BOTH old_lines and new_lines
 * - Empty lines go into BOTH old_lines and new_lines
 * - `+` lines go into new_lines only
 * - `-` lines go into old_lines only
 * - Other prefixes (or *** markers) terminate the chunk
 */
export function parseUpdateFileChunk(
  lines: string[],
  lineNumber: number,
  allowMissingContext: boolean,
): { chunk: UpdateFileChunk; linesConsumed: number } {
  if (lines.length === 0) {
    throw new PatchParseError(
      "Update hunk does not contain any lines",
      lineNumber,
    );
  }

  // Parse @@ header
  let changeContext: string | null = null;
  let startIndex: number;

  if (lines[0] === EMPTY_CHANGE_CONTEXT_MARKER) {
    // Bare `@@` — no context text
    changeContext = null;
    startIndex = 1;
  } else if (lines[0].startsWith(CHANGE_CONTEXT_PREFIX)) {
    // `@@ some context text`
    changeContext = lines[0].slice(CHANGE_CONTEXT_PREFIX.length);
    startIndex = 1;
  } else {
    if (!allowMissingContext) {
      throw new PatchParseError(
        `Expected update hunk to start with a @@ context marker, got: '${lines[0]}'`,
        lineNumber,
      );
    }
    startIndex = 0;
  }

  if (startIndex >= lines.length) {
    throw new PatchParseError(
      "Update hunk does not contain any lines",
      lineNumber + 1,
    );
  }

  const oldLines: string[] = [];
  const newLines: string[] = [];
  let isEndOfFile = false;
  let parsedLines = 0;

  for (const line of lines.slice(startIndex)) {
    if (line === EOF_MARKER) {
      if (parsedLines === 0) {
        throw new PatchParseError(
          "Update hunk does not contain any lines",
          lineNumber + 1,
        );
      }
      isEndOfFile = true;
      parsedLines++;
      break;
    }

    const firstChar = line.length > 0 ? line[0] : null;

    switch (firstChar) {
      case null:
        // Empty line → push empty string to both old and new
        oldLines.push("");
        newLines.push("");
        break;
      case " ":
        // Context line → push to both old and new (strip leading space)
        oldLines.push(line.slice(1));
        newLines.push(line.slice(1));
        break;
      case "+":
        newLines.push(line.slice(1));
        break;
      case "-":
        oldLines.push(line.slice(1));
        break;
      default:
        // Not a diff line. If we haven't parsed any lines yet, it's an error.
        if (parsedLines === 0) {
          throw new PatchParseError(
            `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
            lineNumber + 1,
          );
        }
        // Otherwise, assume start of next hunk — stop.
        return {
          chunk: { changeContext, oldLines, newLines, isEndOfFile },
          linesConsumed: parsedLines + startIndex,
        };
    }
    parsedLines++;
  }

  return {
    chunk: { changeContext, oldLines, newLines, isEndOfFile },
    linesConsumed: parsedLines + startIndex,
  };
}
