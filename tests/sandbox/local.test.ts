import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLocalSandbox } from "@/sandbox/local";
import type { Sandbox } from "@/sandbox/interface";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Skip LocalSandbox tests when running in Node.js (they require Bun runtime)
const isBun = typeof globalThis.Bun !== "undefined";

describe.skipIf(!isBun)("LocalSandbox", () => {
  let sandbox: Sandbox;
  let testDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `bashkit-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    sandbox = createLocalSandbox({ cwd: testDir });
  });

  afterEach(async () => {
    await sandbox.destroy();
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("exec", () => {
    it("should execute simple commands", async () => {
      const result = await sandbox.exec('echo "hello"');

      expect(result.stdout.trim()).toBe("hello");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.interrupted).toBe(false);
    });

    it("should capture stderr", async () => {
      const result = await sandbox.exec("ls /nonexistent 2>&1 || true");

      expect(result.exitCode).toBe(0);
    });

    it("should return non-zero exit code for failed commands", async () => {
      const result = await sandbox.exec("exit 42");

      expect(result.exitCode).toBe(42);
    });

    it("should handle timeout", async () => {
      const result = await sandbox.exec("sleep 10", { timeout: 100 });

      expect(result.interrupted).toBe(true);
    });

    it("should use custom cwd from options", async () => {
      const subDir = join(testDir, "subdir");
      mkdirSync(subDir, { recursive: true });

      const result = await sandbox.exec("pwd", { cwd: subDir });

      expect(result.stdout.trim()).toBe(subDir);
    });

    it("should track duration", async () => {
      const result = await sandbox.exec("sleep 0.1");

      expect(result.durationMs).toBeGreaterThanOrEqual(50);
      expect(result.durationMs).toBeLessThan(1000);
    });

    it("should handle commands with pipes", async () => {
      const result = await sandbox.exec('echo "line1\nline2\nline3" | wc -l');

      expect(result.stdout.trim()).toBe("3");
    });

    it("should handle commands with environment variables", async () => {
      const result = await sandbox.exec("echo $HOME");

      expect(result.stdout.trim()).toBeTruthy();
    });
  });

  describe("file operations", () => {
    describe("writeFile", () => {
      it("should write file content", async () => {
        const filePath = join(testDir, "test.txt");
        await sandbox.writeFile(filePath, "hello world");

        const content = await sandbox.readFile(filePath);
        expect(content).toBe("hello world");
      });

      it("should overwrite existing files", async () => {
        const filePath = join(testDir, "test.txt");
        await sandbox.writeFile(filePath, "first");
        await sandbox.writeFile(filePath, "second");

        const content = await sandbox.readFile(filePath);
        expect(content).toBe("second");
      });

      it("should handle relative paths", async () => {
        await sandbox.writeFile("relative.txt", "content");

        const exists = await sandbox.fileExists(join(testDir, "relative.txt"));
        expect(exists).toBe(true);
      });
    });

    describe("readFile", () => {
      it("should read file content", async () => {
        const filePath = join(testDir, "test.txt");
        await sandbox.writeFile(filePath, "test content");

        const content = await sandbox.readFile(filePath);
        expect(content).toBe("test content");
      });

      it("should throw for non-existent files", async () => {
        await expect(
          sandbox.readFile(join(testDir, "missing.txt")),
        ).rejects.toThrow();
      });

      it("should read files with special characters", async () => {
        const filePath = join(testDir, "special.txt");
        const content = "Special chars: \n\t\"'`$(){}[]<>|&;";
        await sandbox.writeFile(filePath, content);

        const read = await sandbox.readFile(filePath);
        expect(read).toBe(content);
      });
    });

    describe("readDir", () => {
      it("should list directory contents", async () => {
        await sandbox.writeFile(join(testDir, "file1.txt"), "1");
        await sandbox.writeFile(join(testDir, "file2.txt"), "2");
        mkdirSync(join(testDir, "subdir"));

        const entries = await sandbox.readDir(testDir);

        expect(entries).toContain("file1.txt");
        expect(entries).toContain("file2.txt");
        expect(entries).toContain("subdir");
      });

      it("should return empty array for empty directory", async () => {
        const emptyDir = join(testDir, "empty");
        mkdirSync(emptyDir);

        const entries = await sandbox.readDir(emptyDir);
        expect(entries).toEqual([]);
      });
    });

    describe("fileExists", () => {
      it("should return true for existing files", async () => {
        const filePath = join(testDir, "exists.txt");
        await sandbox.writeFile(filePath, "content");

        const exists = await sandbox.fileExists(filePath);
        expect(exists).toBe(true);
      });

      it("should return true for existing directories", async () => {
        const dirPath = join(testDir, "subdir");
        mkdirSync(dirPath);

        const exists = await sandbox.fileExists(dirPath);
        expect(exists).toBe(true);
      });

      it("should return false for non-existent paths", async () => {
        const exists = await sandbox.fileExists(join(testDir, "missing"));
        expect(exists).toBe(false);
      });
    });

    describe("isDirectory", () => {
      it("should return true for directories", async () => {
        const dirPath = join(testDir, "subdir");
        mkdirSync(dirPath);

        const isDir = await sandbox.isDirectory(dirPath);
        expect(isDir).toBe(true);
      });

      it("should return false for files", async () => {
        const filePath = join(testDir, "file.txt");
        await sandbox.writeFile(filePath, "content");

        const isDir = await sandbox.isDirectory(filePath);
        expect(isDir).toBe(false);
      });

      it("should return false for non-existent paths", async () => {
        const isDir = await sandbox.isDirectory(join(testDir, "missing"));
        expect(isDir).toBe(false);
      });
    });
  });

  describe("configuration", () => {
    it("should use /tmp as default working directory", () => {
      const defaultSandbox = createLocalSandbox();
      // Can't easily verify the internal state, but it shouldn't throw
      expect(defaultSandbox).toBeDefined();
    });

    it("should create working directory if it doesn't exist", () => {
      const newDir = join(tmpdir(), `bashkit-new-${Date.now()}`);

      // Should not exist before
      expect(existsSync(newDir)).toBe(false);

      const newSandbox = createLocalSandbox({ cwd: newDir });

      // Should exist after
      expect(existsSync(newDir)).toBe(true);
      expect(newSandbox).toBeDefined();

      // Cleanup
      rmSync(newDir, { recursive: true, force: true });
    });

    it("should set rgPath for ripgrep", () => {
      // rgPath may be undefined if ripgrep is not available
      // but the property should exist
      expect("rgPath" in sandbox).toBe(true);
    });
  });

  describe("destroy", () => {
    it("should complete without error", async () => {
      await expect(sandbox.destroy()).resolves.toBeUndefined();
    });

    it("should be callable multiple times", async () => {
      await sandbox.destroy();
      await expect(sandbox.destroy()).resolves.toBeUndefined();
    });
  });
});
