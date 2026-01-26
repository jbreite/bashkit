import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Sandbox } from "@/sandbox/interface";

// Mock the @e2b/code-interpreter module before importing createE2BSandbox
const mockRun = vi.fn();
const mockFilesWrite = vi.fn();
const mockKill = vi.fn();
const mockSandboxId = "e2b-sandbox-123";

vi.mock("@e2b/code-interpreter", () => ({
  Sandbox: {
    create: vi.fn().mockResolvedValue({
      sandboxId: mockSandboxId,
      commands: {
        run: mockRun,
      },
      files: {
        write: mockFilesWrite,
      },
      kill: mockKill,
    }),
    connect: vi.fn().mockResolvedValue({
      sandboxId: mockSandboxId,
      commands: {
        run: mockRun,
      },
      files: {
        write: mockFilesWrite,
      },
      kill: mockKill,
    }),
  },
}));

// Now import after the mock is set up
import { createE2BSandbox } from "@/sandbox/e2b";

describe("E2BSandbox", () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockRun.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });

    mockFilesWrite.mockResolvedValue(undefined);
    mockKill.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (sandbox) {
      await sandbox.destroy();
    }
  });

  describe("creation", () => {
    it("should create a sandbox with default config", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      expect(sandbox).toBeDefined();
      expect(sandbox.exec).toBeDefined();
      expect(sandbox.readFile).toBeDefined();
      expect(sandbox.writeFile).toBeDefined();
    });

    it("should expose sandbox ID", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      // Trigger sandbox initialization
      await sandbox.exec("echo test");

      expect(sandbox.id).toBe(mockSandboxId);
    });

    it("should reconnect with existing sandbox ID", async () => {
      const { Sandbox: E2BSandboxSDK } = await import("@e2b/code-interpreter");

      sandbox = await createE2BSandbox({
        sandboxId: "existing-456",
        ensureTools: false,
      });

      // Trigger initialization
      await sandbox.exec("echo test");

      expect(E2BSandboxSDK.connect).toHaveBeenCalledWith("existing-456");
    });

    it("should pass API key to create", async () => {
      const { Sandbox: E2BSandboxSDK } = await import("@e2b/code-interpreter");

      sandbox = await createE2BSandbox({
        apiKey: "test-api-key",
        ensureTools: false,
      });

      // Trigger initialization
      await sandbox.exec("echo test");

      expect(E2BSandboxSDK.create).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "test-api-key" }),
      );
    });
  });

  describe("exec", () => {
    it("should execute commands", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: "hello world",
        stderr: "",
      });

      const result = await sandbox.exec("echo hello world");

      expect(result.stdout).toBe("hello world");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.interrupted).toBe(false);
    });

    it("should handle non-zero exit codes", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      mockRun.mockRejectedValueOnce(new Error("exit status 1"));

      const result = await sandbox.exec("exit 1");

      expect(result.exitCode).toBe(1);
    });

    it("should handle timeout errors", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      mockRun.mockRejectedValueOnce(new Error("Command timeout exceeded"));

      const result = await sandbox.exec("sleep 100", { timeout: 100 });

      expect(result.interrupted).toBe(true);
      expect(result.exitCode).toBe(124);
    });

    it("should pass cwd option", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      await sandbox.exec("ls", { cwd: "/custom/path" });

      expect(mockRun).toHaveBeenCalledWith(
        "ls",
        expect.objectContaining({ cwd: "/custom/path" }),
      );
    });

    it("should pass timeout option", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      await sandbox.exec("ls", { timeout: 5000 });

      expect(mockRun).toHaveBeenCalledWith(
        "ls",
        expect.objectContaining({ timeoutMs: 5000 }),
      );
    });

    it("should track execution duration", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      mockRun.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { exitCode: 0, stdout: "", stderr: "" };
      });

      const result = await sandbox.exec("sleep 0.05");

      // Use a slightly lower threshold to account for timing variance
      expect(result.durationMs).toBeGreaterThanOrEqual(45);
    });
  });

  describe("file operations", () => {
    it("should read files via cat command", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: "file content here",
        stderr: "",
      });

      const content = await sandbox.readFile("/test/file.txt");

      expect(content).toBe("file content here");
      expect(mockRun).toHaveBeenCalledWith(
        'cat "/test/file.txt"',
        expect.any(Object),
      );
    });

    it("should throw for non-existent files", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      mockRun.mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "cat: /missing: No such file or directory",
      });

      await expect(sandbox.readFile("/missing")).rejects.toThrow();
    });

    it("should write files using SDK", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      // Trigger initialization
      await sandbox.exec("true");

      await sandbox.writeFile("/test/file.txt", "new content");

      expect(mockFilesWrite).toHaveBeenCalledWith(
        "/test/file.txt",
        "new content",
      );
    });

    it("should read directories via ls command", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: "file1.txt\nfile2.txt\nsubdir",
        stderr: "",
      });

      const entries = await sandbox.readDir("/test");

      expect(entries).toEqual(["file1.txt", "file2.txt", "subdir"]);
    });

    it("should throw on readDir error", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      mockRun.mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "ls: cannot access: No such file",
      });

      await expect(sandbox.readDir("/missing")).rejects.toThrow();
    });

    it("should check file existence via test -e", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const exists = await sandbox.fileExists("/test/file.txt");

      expect(exists).toBe(true);
      expect(mockRun).toHaveBeenCalledWith(
        'test -e "/test/file.txt"',
        expect.any(Object),
      );
    });

    it("should return false for non-existent files", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      mockRun.mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "",
      });

      const exists = await sandbox.fileExists("/missing");

      expect(exists).toBe(false);
    });

    it("should check if path is directory via test -d", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const isDir = await sandbox.isDirectory("/test/dir");

      expect(isDir).toBe(true);
      expect(mockRun).toHaveBeenCalledWith(
        'test -d "/test/dir"',
        expect.any(Object),
      );
    });

    it("should return false when path is not directory", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      mockRun.mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "",
      });

      const isDir = await sandbox.isDirectory("/test/file.txt");

      expect(isDir).toBe(false);
    });
  });

  describe("destroy", () => {
    it("should kill the sandbox", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      // Trigger initialization
      await sandbox.exec("true");

      await sandbox.destroy();

      expect(mockKill).toHaveBeenCalled();
    });

    it("should handle destroy when never initialized", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      // Never call exec, so sandbox is never created
      await expect(sandbox.destroy()).resolves.toBeUndefined();
    });
  });

  describe("configuration", () => {
    it("should use /home/user as default cwd", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      await sandbox.exec("pwd");

      expect(mockRun).toHaveBeenCalledWith(
        "pwd",
        expect.objectContaining({ cwd: "/home/user" }),
      );
    });

    it("should support custom cwd", async () => {
      sandbox = await createE2BSandbox({
        cwd: "/workspace",
        ensureTools: false,
      });

      await sandbox.exec("pwd");

      expect(mockRun).toHaveBeenCalledWith(
        "pwd",
        expect.objectContaining({ cwd: "/workspace" }),
      );
    });

    it("should support custom timeout", async () => {
      const { Sandbox: E2BSandboxSDK } = await import("@e2b/code-interpreter");

      sandbox = await createE2BSandbox({
        timeout: 60000,
        ensureTools: false,
      });

      // Trigger initialization
      await sandbox.exec("true");

      expect(E2BSandboxSDK.create).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 60000 }),
      );
    });

    it("should support metadata", async () => {
      const { Sandbox: E2BSandboxSDK } = await import("@e2b/code-interpreter");

      sandbox = await createE2BSandbox({
        metadata: { project: "test", env: "ci" },
        ensureTools: false,
      });

      // Trigger initialization
      await sandbox.exec("true");

      expect(E2BSandboxSDK.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { project: "test", env: "ci" },
        }),
      );
    });
  });

  describe("rgPath", () => {
    it("should have rgPath property", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      expect("rgPath" in sandbox).toBe(true);
    });

    it("should allow setting rgPath", async () => {
      sandbox = await createE2BSandbox({ ensureTools: false });

      sandbox.rgPath = "/usr/bin/rg";
      expect(sandbox.rgPath).toBe("/usr/bin/rg");
    });
  });
});
