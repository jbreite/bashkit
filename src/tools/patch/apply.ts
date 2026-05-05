/**
 * Application logic for parsed patches.
 * Faithful port of Codex codex-rs/apply-patch/src/lib.rs
 */

import { seekSequence } from "./seek-sequence";
import { PatchApplicationError, type UpdateFileChunk } from "./types";

/** A replacement to apply: [startIndex, oldLineCount, newLines] */
type Replacement = [number, number, string[]];

/**
 * Compute replacements for an update operation.
 * Faithful port of Codex compute_replacements.
 *
 * For each chunk:
 * 1. If changeContext exists, seek for it (single line) to narrow position
 * 2. If old_lines is empty → pure addition at end of file
 * 3. Otherwise, seek old_lines and schedule replacement
 * 4. If seek fails and old_lines ends with empty string, retry without it
 *
 * @param originalLines - The file split into lines (trailing empty dropped)
 * @param filePath - File path for error messages
 * @param chunks - The update chunks to apply
 * @returns Array of [startIdx, oldLen, newLines] tuples, sorted by startIdx
 */
export function computeReplacements(
  originalLines: string[],
  filePath: string,
  chunks: UpdateFileChunk[],
): Replacement[] {
  const replacements: Replacement[] = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    // Step 1: If changeContext exists, seek for it to narrow position
    if (chunk.changeContext !== null) {
      const idx = seekSequence(
        originalLines,
        [chunk.changeContext],
        lineIndex,
        false,
      );
      if (idx === null) {
        throw new PatchApplicationError(
          `Failed to find context '${chunk.changeContext}' in ${filePath} searched from line ${lineIndex + 1}. Read the file to verify current content before retrying.`,
          filePath,
        );
      }
      lineIndex = idx + 1;
    }

    // Step 2: Handle pure addition (no old lines)
    if (chunk.oldLines.length === 0) {
      // Insert at end of file, or just before trailing empty line if one exists
      const insertionIdx =
        originalLines.length > 0 &&
        originalLines[originalLines.length - 1] === ""
          ? originalLines.length - 1
          : originalLines.length;
      replacements.push([insertionIdx, 0, [...chunk.newLines]]);
      continue;
    }

    // Step 3: Seek old_lines in the file
    let pattern: string[] = chunk.oldLines;
    let found = seekSequence(
      originalLines,
      pattern,
      lineIndex,
      chunk.isEndOfFile,
    );
    let newSlice: string[] = chunk.newLines;

    // Step 4: Retry without trailing empty line
    // Many real-world diffs have a trailing empty string representing the final
    // newline. This sentinel isn't in originalLines (we stripped it), so retry
    // without it.
    if (
      found === null &&
      pattern.length > 0 &&
      pattern[pattern.length - 1] === ""
    ) {
      pattern = pattern.slice(0, -1);
      if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
        newSlice = newSlice.slice(0, -1);
      }
      found = seekSequence(
        originalLines,
        pattern,
        lineIndex,
        chunk.isEndOfFile,
      );
    }

    if (found !== null) {
      replacements.push([found, pattern.length, [...newSlice]]);
      lineIndex = found + pattern.length;
    } else {
      throw new PatchApplicationError(
        `Failed to find expected lines in ${filePath} searched from line ${lineIndex + 1}:\n${chunk.oldLines.join("\n")}\nRead the file to verify current content before retrying.`,
        filePath,
      );
    }
  }

  // Sort by start index (ascending)
  replacements.sort((a, b) => a[0] - b[0]);

  return replacements;
}

/**
 * Apply replacements to lines in reverse order to avoid index shifting.
 * Faithful port of Codex apply_replacements.
 */
export function applyReplacements(
  lines: string[],
  replacements: Replacement[],
): string[] {
  const result = [...lines];

  // Apply in reverse order (descending start index)
  for (let i = replacements.length - 1; i >= 0; i--) {
    const [startIdx, oldLen, newLines] = replacements[i];
    result.splice(startIdx, oldLen, ...newLines);
  }

  return result;
}

/**
 * Derive new file contents from original content and update chunks.
 * Faithful port of Codex derive_new_contents_from_chunks.
 *
 * @param originalContent - The original file content as a string
 * @param chunks - The update chunks to apply
 * @param filePath - File path for error messages
 * @returns The new file content as a string
 */
export function deriveNewContents(
  originalContent: string,
  chunks: UpdateFileChunk[],
  filePath: string,
): string {
  // Split into lines. Drop trailing empty element from final newline
  // (matches Codex behavior: standard diff line counting)
  let originalLines = originalContent.split("\n");
  if (
    originalLines.length > 0 &&
    originalLines[originalLines.length - 1] === ""
  ) {
    originalLines = originalLines.slice(0, -1);
  }

  const replacements = computeReplacements(originalLines, filePath, chunks);
  const newLines = applyReplacements(originalLines, replacements);

  // Ensure trailing newline (Codex: push empty string if last isn't empty, then join with \n)
  const result = [...newLines];
  if (result.length === 0 || result[result.length - 1] !== "") {
    result.push("");
  }
  return result.join("\n");
}
