/**
 * Mock Sandbox implementation for testing tools
 *
 * Provides a configurable in-memory filesystem and command execution
 * for testing tool implementations without actual filesystem access.
 */

import type { ExecOptions, ExecResult, Sandbox } from "@/sandbox/interface";

/**
 * Mock filesystem entry - can be a file (string content) or directory (array of names)
 */
export type MockFileEntry = string | string[];

/**
 * Mock filesystem structure
 */
export type MockFileSystem = Record<string, MockFileEntry>;

/**
 * Command execution history entry
 */
export interface ExecHistoryEntry {
  command: string;
  options?: ExecOptions;
  result: ExecResult;
}

/**
 * Custom exec handler for configuring command responses
 */
export type ExecHandler = (
  command: string,
  options?: ExecOptions,
) => ExecResult | Promise<ExecResult>;

/**
 * Options for creating a MockSandbox
 */
export interface MockSandboxOptions {
  /** Initial filesystem state */
  files?: MockFileSystem;
  /** Custom command execution handler */
  execHandler?: ExecHandler;
  /** Default exec result when no handler matches */
  defaultExecResult?: Partial<ExecResult>;
  /** Path to ripgrep binary (for Grep tool) */
  rgPath?: string;
}

/**
 * Default exec result for commands
 */
const DEFAULT_EXEC_RESULT: ExecResult = {
  stdout: "",
  stderr: "",
  exitCode: 0,
  durationMs: 1,
  interrupted: false,
};

/**
 * Creates a mock sandbox for testing
 *
 * @example
 * ```typescript
 * const sandbox = createMockSandbox({
 *   files: {
 *     '/workspace/file.ts': 'const x = 1;',
 *     '/workspace/src': ['index.ts', 'utils.ts'],
 *   },
 *   execHandler: (cmd) => ({
 *     stdout: 'mocked output',
 *     stderr: '',
 *     exitCode: 0,
 *     durationMs: 10,
 *     interrupted: false,
 *   }),
 * });
 * ```
 */
export function createMockSandbox(
  options: MockSandboxOptions = {},
): MockSandbox {
  const files: MockFileSystem = { ...options.files };
  const execHistory: ExecHistoryEntry[] = [];
  let execHandler = options.execHandler;
  const defaultResult = {
    ...DEFAULT_EXEC_RESULT,
    ...options.defaultExecResult,
  };

  const sandbox: MockSandbox = {
    rgPath: options.rgPath,

    async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
      let result: ExecResult;

      if (execHandler) {
        result = await execHandler(command, opts);
      } else {
        result = { ...defaultResult };
      }

      execHistory.push({ command, options: opts, result });
      return result;
    },

    async readFile(path: string): Promise<string> {
      const entry = files[path];
      if (entry === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      if (Array.isArray(entry)) {
        throw new Error(
          `EISDIR: illegal operation on a directory, read '${path}'`,
        );
      }
      return entry;
    },

    async writeFile(path: string, content: string): Promise<void> {
      files[path] = content;
    },

    async readDir(path: string): Promise<string[]> {
      const entry = files[path];
      if (entry === undefined) {
        throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
      }
      if (!Array.isArray(entry)) {
        throw new Error(`ENOTDIR: not a directory, scandir '${path}'`);
      }
      return entry;
    },

    async fileExists(path: string): Promise<boolean> {
      return path in files;
    },

    async isDirectory(path: string): Promise<boolean> {
      const entry = files[path];
      return Array.isArray(entry);
    },

    async destroy(): Promise<void> {
      // No-op for mock
    },

    // Test inspection methods
    getFiles(): MockFileSystem {
      return { ...files };
    },

    setFile(path: string, content: MockFileEntry): void {
      files[path] = content;
    },

    deleteFile(path: string): void {
      delete files[path];
    },

    getExecHistory(): ExecHistoryEntry[] {
      return [...execHistory];
    },

    clearExecHistory(): void {
      execHistory.length = 0;
    },

    setExecHandler(handler: ExecHandler | undefined): void {
      execHandler = handler;
    },

    setDefaultExecResult(result: Partial<ExecResult>): void {
      Object.assign(defaultResult, result);
    },
  };

  return sandbox;
}

/**
 * Extended Sandbox interface with test inspection methods
 */
export interface MockSandbox extends Sandbox {
  /** Get current filesystem state */
  getFiles(): MockFileSystem;
  /** Set a file or directory */
  setFile(path: string, content: MockFileEntry): void;
  /** Delete a file or directory */
  deleteFile(path: string): void;
  /** Get command execution history */
  getExecHistory(): ExecHistoryEntry[];
  /** Clear command execution history */
  clearExecHistory(): void;
  /** Set custom exec handler */
  setExecHandler(handler: ExecHandler | undefined): void;
  /** Set default exec result */
  setDefaultExecResult(result: Partial<ExecResult>): void;
}
