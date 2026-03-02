/**
 * Types for the Patch tool (Codex apply-patch format).
 */

// --- Hunk types ---

export interface AddFileHunk {
  type: "add";
  path: string;
  content: string;
}

export interface DeleteFileHunk {
  type: "delete";
  path: string;
}

export interface UpdateFileChunk {
  /**
   * A single line of context used to narrow down the position of the chunk.
   * This is the text from the `@@ context` header (e.g., a class/method/function definition).
   * null when the `@@` header has no text or is omitted entirely.
   */
  changeContext: string | null;
  /** Lines to match for replacement (includes space-prefixed context lines pushed to both old and new) */
  oldLines: string[];
  /** Replacement lines (includes space-prefixed context lines pushed to both old and new) */
  newLines: string[];
  /** Whether this chunk is at the end of the file */
  isEndOfFile: boolean;
}

export interface UpdateFileHunk {
  type: "update";
  path: string;
  /** Optional move/rename destination */
  movePath?: string;
  chunks: UpdateFileChunk[];
}

export type Hunk = AddFileHunk | DeleteFileHunk | UpdateFileHunk;

// --- Parsed patch ---

export interface ParsedPatch {
  hunks: Hunk[];
}

// --- Error classes ---

export class PatchParseError extends Error {
  constructor(
    message: string,
    public readonly lineNumber?: number,
  ) {
    super(lineNumber !== undefined ? `Line ${lineNumber}: ${message}` : message);
    this.name = "PatchParseError";
  }
}

export class PatchApplicationError extends Error {
  constructor(
    message: string,
    public readonly filePath?: string,
  ) {
    super(filePath ? `${filePath}: ${message}` : message);
    this.name = "PatchApplicationError";
  }
}

// --- Tool output types ---

export interface PatchFileResult {
  status: "added" | "modified" | "deleted";
  path: string;
}

export interface PatchOutput {
  message: string;
  files: PatchFileResult[];
}

export interface PatchError {
  error: string;
}
