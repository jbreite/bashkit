import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Sandbox } from "@/sandbox/interface";

// Mock the @vercel/sandbox module before importing createVercelSandbox
const mockRunCommand = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFiles = vi.fn();
const mockStop = vi.fn();
const mockSandboxId = "test-sandbox-123";

vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    create: vi.fn().mockResolvedValue({
      sandboxId: mockSandboxId,
      runCommand: mockRunCommand,
      readFile: mockReadFile,
      writeFiles: mockWriteFiles,
      stop: mockStop,
    }),
    get: vi.fn().mockResolvedValue({
      sandboxId: mockSandboxId,
      runCommand: mockRunCommand,
      readFile: mockReadFile,
      writeFiles: mockWriteFiles,
      stop: mockStop,
    }),
  },
}));

// Now import after the mock is set up
import { createVercelSandbox } from "@/sandbox/vercel";

describe("VercelSandbox", () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockRunCommand.mockResolvedValue({
      exitCode: 0,
      stdout: vi.fn().mockResolvedValue(""),
      stderr: vi.fn().mockResolvedValue(""),
    });

    mockReadFile.mockResolvedValue(
      (async function* () {
        yield Buffer.from("file content");
      })(),
    );

    mockWriteFiles.mockResolvedValue(undefined);
    mockStop.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (sandbox) {
      await sandbox.destroy();
    }
  });

  describe("creation", () => {
    it("should create a sandbox with default config", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      expect(sandbox).toBeDefined();
      expect(sandbox.exec).toBeDefined();
      expect(sandbox.readFile).toBeDefined();
      expect(sandbox.writeFile).toBeDefined();
    });

    it("should expose sandbox ID", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      // Trigger sandbox initialization by calling exec
      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue(""),
        stderr: vi.fn().mockResolvedValue(""),
      });
      await sandbox.exec("echo test");

      expect(sandbox.id).toBe(mockSandboxId);
    });

    it("should reconnect with existing sandbox ID", async () => {
      const { Sandbox: VercelSandboxSDK } = await import("@vercel/sandbox");

      sandbox = await createVercelSandbox({
        sandboxId: "existing-123",
        ensureTools: false,
      });

      // Trigger sandbox initialization
      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue(""),
        stderr: vi.fn().mockResolvedValue(""),
      });
      await sandbox.exec("echo test");

      expect(VercelSandboxSDK.get).toHaveBeenCalledWith({
        sandboxId: "existing-123",
      });
    });
  });

  describe("exec", () => {
    it("should execute commands", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue("hello\n"),
        stderr: vi.fn().mockResolvedValue(""),
      });

      const result = await sandbox.exec("echo hello");

      expect(result.stdout).toBe("hello\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.interrupted).toBe(false);
    });

    it("should handle command timeout", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      // Mock a slow command by delaying
      mockRunCommand.mockImplementationOnce(async ({ signal }) => {
        return new Promise((_, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("aborted"));
          }, 10000);

          signal?.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new Error("aborted"));
          });
        });
      });

      const result = await sandbox.exec("sleep 10", { timeout: 50 });

      expect(result.interrupted).toBe(true);
      expect(result.exitCode).toBe(124);
    });

    it("should pass cwd option", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue(""),
        stderr: vi.fn().mockResolvedValue(""),
      });

      await sandbox.exec("ls", { cwd: "/custom/path" });

      expect(mockRunCommand).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/custom/path" }),
      );
    });

    it("should track execution duration", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      mockRunCommand.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return {
          exitCode: 0,
          stdout: vi.fn().mockResolvedValue(""),
          stderr: vi.fn().mockResolvedValue(""),
        };
      });

      const result = await sandbox.exec("sleep 0.05");

      expect(result.durationMs).toBeGreaterThanOrEqual(50);
    });
  });

  describe("file operations", () => {
    it("should read files", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      // Trigger initialization
      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue(""),
        stderr: vi.fn().mockResolvedValue(""),
      });
      await sandbox.exec("true");

      mockReadFile.mockResolvedValueOnce(
        (async function* () {
          yield Buffer.from("test content");
        })(),
      );

      const content = await sandbox.readFile("/test/file.txt");
      expect(content).toBe("test content");
    });

    it("should throw for non-existent files", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      // Trigger initialization
      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue(""),
        stderr: vi.fn().mockResolvedValue(""),
      });
      await sandbox.exec("true");

      mockReadFile.mockResolvedValueOnce(null);

      await expect(sandbox.readFile("/missing")).rejects.toThrow("not found");
    });

    it("should write files", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      // Trigger initialization
      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue(""),
        stderr: vi.fn().mockResolvedValue(""),
      });
      await sandbox.exec("true");

      await sandbox.writeFile("/test/file.txt", "new content");

      expect(mockWriteFiles).toHaveBeenCalledWith([
        expect.objectContaining({
          path: "/test/file.txt",
          content: expect.any(Buffer),
        }),
      ]);
    });

    it("should read directories via exec", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue("file1.txt\nfile2.txt\n"),
        stderr: vi.fn().mockResolvedValue(""),
      });

      const entries = await sandbox.readDir("/test");

      expect(entries).toEqual(["file1.txt", "file2.txt"]);
    });

    it("should check file existence via exec", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue(""),
        stderr: vi.fn().mockResolvedValue(""),
      });

      const exists = await sandbox.fileExists("/test/file.txt");
      expect(exists).toBe(true);
    });

    it("should check if path is directory via exec", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue(""),
        stderr: vi.fn().mockResolvedValue(""),
      });

      const isDir = await sandbox.isDirectory("/test");
      expect(isDir).toBe(true);
    });
  });

  describe("destroy", () => {
    it("should stop the sandbox", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      // Trigger initialization
      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue(""),
        stderr: vi.fn().mockResolvedValue(""),
      });
      await sandbox.exec("true");

      await sandbox.destroy();

      expect(mockStop).toHaveBeenCalled();
    });

    it("should handle destroy when never initialized", async () => {
      sandbox = await createVercelSandbox({ ensureTools: false });

      // Never call exec, so sandbox is never created
      await expect(sandbox.destroy()).resolves.toBeUndefined();
    });
  });

  describe("configuration", () => {
    it("should use default runtime node22", async () => {
      const { Sandbox: VercelSandboxSDK } = await import("@vercel/sandbox");

      sandbox = await createVercelSandbox({ ensureTools: false });

      // Trigger initialization
      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue(""),
        stderr: vi.fn().mockResolvedValue(""),
      });
      await sandbox.exec("true");

      expect(VercelSandboxSDK.create).toHaveBeenCalledWith(
        expect.objectContaining({ runtime: "node22" }),
      );
    });

    it("should support custom runtime", async () => {
      const { Sandbox: VercelSandboxSDK } = await import("@vercel/sandbox");

      sandbox = await createVercelSandbox({
        runtime: "python3.13",
        ensureTools: false,
      });

      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue(""),
        stderr: vi.fn().mockResolvedValue(""),
      });
      await sandbox.exec("true");

      expect(VercelSandboxSDK.create).toHaveBeenCalledWith(
        expect.objectContaining({ runtime: "python3.13" }),
      );
    });

    it("should support team and token config", async () => {
      const { Sandbox: VercelSandboxSDK } = await import("@vercel/sandbox");

      sandbox = await createVercelSandbox({
        teamId: "team-123",
        token: "secret-token",
        ensureTools: false,
      });

      mockRunCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue(""),
        stderr: vi.fn().mockResolvedValue(""),
      });
      await sandbox.exec("true");

      expect(VercelSandboxSDK.create).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: "team-123",
          token: "secret-token",
        }),
      );
    });
  });
});
