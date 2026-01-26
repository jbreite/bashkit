/**
 * Mock for @vercel/sandbox module
 *
 * Provides a configurable mock of the Vercel Sandbox for testing
 * without actual VM provisioning.
 */

import { vi } from "vitest";
import type { MockFileSystem, ExecHandler } from "../helpers/mock-sandbox";

/**
 * Configuration for mock Vercel Sandbox
 */
export interface MockVercelSandboxConfig {
  /** Initial filesystem state */
  files?: MockFileSystem;
  /** Custom exec handler */
  execHandler?: ExecHandler;
  /** Sandbox ID to return */
  sandboxId?: string;
}

/**
 * Creates a mock Vercel Sandbox class
 */
export function createMockVercelSandbox(config: MockVercelSandboxConfig = {}) {
  const files: MockFileSystem = { ...config.files };
  const sandboxId = config.sandboxId ?? "mock-vercel-sandbox-id";

  const mockInstance = {
    id: sandboxId,

    process: {
      create: vi.fn().mockImplementation(async (command: string) => {
        if (config.execHandler) {
          const result = await config.execHandler(command);
          return {
            exited: Promise.resolve({ exitCode: result.exitCode }),
            output: {
              [Symbol.asyncIterator]: async function* () {
                yield { type: "stdout", data: result.stdout };
                if (result.stderr) {
                  yield { type: "stderr", data: result.stderr };
                }
              },
            },
            kill: vi.fn(),
          };
        }
        return {
          exited: Promise.resolve({ exitCode: 0 }),
          output: {
            [Symbol.asyncIterator]: async function* () {
              yield { type: "stdout", data: "" };
            },
          },
          kill: vi.fn(),
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
        return content.map((name) => ({ name, isDirectory: () => false }));
      }),

      exists: vi.fn().mockImplementation(async (path: string) => {
        return path in files;
      }),

      stat: vi.fn().mockImplementation(async (path: string) => {
        const content = files[path];
        if (content === undefined) {
          throw new Error(`ENOENT: no such file or directory: ${path}`);
        }
        return {
          isDirectory: () => Array.isArray(content),
          isFile: () => !Array.isArray(content),
          size: Array.isArray(content) ? 0 : content.length,
        };
      }),
    },

    close: vi.fn().mockResolvedValue(undefined),
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
 * Setup @vercel/sandbox mock with vi.doMock
 *
 * @example
 * ```typescript
 * import { setupVercelSandboxMock } from '@test/mocks/vercel-sandbox';
 *
 * const { mockInstance } = setupVercelSandboxMock({
 *   files: { '/workspace/file.ts': 'content' },
 * });
 *
 * const { createVercelSandbox } = await import('@/sandbox/vercel');
 * ```
 */
export function setupVercelSandboxMock(config: MockVercelSandboxConfig = {}) {
  const mock = createMockVercelSandbox(config);

  vi.doMock("@vercel/sandbox", () => mock);

  return mock;
}

/**
 * Reset @vercel/sandbox mock
 */
export function resetVercelSandboxMock() {
  vi.doUnmock("@vercel/sandbox");
}
