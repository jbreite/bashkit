/**
 * Mock for @e2b/code-interpreter module
 *
 * Provides a configurable mock of the E2B Sandbox for testing
 * without actual cloud sandbox provisioning.
 */

import { vi } from "vitest";
import type { MockFileSystem, ExecHandler } from "../helpers/mock-sandbox";

/**
 * Configuration for mock E2B Sandbox
 */
export interface MockE2BSandboxConfig {
  /** Initial filesystem state */
  files?: MockFileSystem;
  /** Custom exec handler */
  execHandler?: ExecHandler;
  /** Sandbox ID to return */
  sandboxId?: string;
}

/**
 * Creates a mock E2B Sandbox class
 */
export function createMockE2BSandbox(config: MockE2BSandboxConfig = {}) {
  const files: MockFileSystem = { ...config.files };
  const sandboxId = config.sandboxId ?? "mock-e2b-sandbox-id";

  const mockInstance = {
    sandboxId,

    commands: {
      run: vi.fn().mockImplementation(async (command: string) => {
        if (config.execHandler) {
          const result = await config.execHandler(command);
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          };
        }
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
        };
      }),
    },

    files: {
      read: vi.fn().mockImplementation(async (path: string) => {
        const content = files[path];
        if (content === undefined) {
          throw new Error(`ENOENT: no such file or directory: ${path}`);
        }
        if (Array.isArray(content)) {
          throw new Error(`EISDIR: illegal operation on a directory: ${path}`);
        }
        return content;
      }),

      write: vi
        .fn()
        .mockImplementation(async (path: string, content: string) => {
          files[path] = content;
        }),

      list: vi.fn().mockImplementation(async (path: string) => {
        const content = files[path];
        if (content === undefined) {
          throw new Error(`ENOENT: no such file or directory: ${path}`);
        }
        if (!Array.isArray(content)) {
          throw new Error(`ENOTDIR: not a directory: ${path}`);
        }
        return content.map((name) => ({
          name,
          isDir: false,
          path: `${path}/${name}`,
        }));
      }),

      exists: vi.fn().mockImplementation(async (path: string) => {
        return path in files;
      }),
    },

    kill: vi.fn().mockResolvedValue(undefined),
  };

  return {
    Sandbox: {
      create: vi.fn().mockResolvedValue(mockInstance),
      connect: vi.fn().mockResolvedValue(mockInstance),
    },
    mockInstance,
  };
}

/**
 * Setup @e2b/code-interpreter mock with vi.doMock
 *
 * @example
 * ```typescript
 * import { setupE2BSandboxMock } from '@test/mocks/e2b-interpreter';
 *
 * const { mockInstance } = setupE2BSandboxMock({
 *   files: { '/workspace/file.ts': 'content' },
 * });
 *
 * const { createE2BSandbox } = await import('@/sandbox/e2b');
 * ```
 */
export function setupE2BSandboxMock(config: MockE2BSandboxConfig = {}) {
  const mock = createMockE2BSandbox(config);

  vi.doMock("@e2b/code-interpreter", () => mock);

  return mock;
}

/**
 * Reset @e2b/code-interpreter mock
 */
export function resetE2BSandboxMock() {
  vi.doUnmock("@e2b/code-interpreter");
}
