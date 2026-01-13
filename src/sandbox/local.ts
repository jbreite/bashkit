import { existsSync, mkdirSync } from "node:fs";
import type { ExecOptions, ExecResult, Sandbox } from "./interface";
import { getBundledRgPath } from "./ripgrep";

export interface LocalSandboxConfig {
  cwd?: string;
}

export async function createLocalSandbox(
  config: LocalSandboxConfig = {},
): Promise<Sandbox> {
  const workingDirectory = config.cwd || "/tmp";
  const rgPath = await getBundledRgPath();

  // Ensure the working directory exists
  if (!existsSync(workingDirectory)) {
    mkdirSync(workingDirectory, { recursive: true });
  }

  const exec = async (
    command: string,
    options?: ExecOptions,
  ): Promise<ExecResult> => {
    const startTime = performance.now();
    let interrupted = false;

    const cwd = options?.cwd || workingDirectory;

    // Ensure cwd exists before spawning
    if (!existsSync(cwd)) {
      mkdirSync(cwd, { recursive: true });
    }

    const proc = Bun.spawn(["sh", "-c", command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeout) {
      timeoutId = setTimeout(() => {
        interrupted = true;
        proc.kill();
      }, options.timeout);
    }

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    const durationMs = Math.round(performance.now() - startTime);

    return {
      stdout,
      stderr,
      exitCode,
      durationMs,
      interrupted,
    };
  };

  return {
    exec,

    // Local sandbox uses bundled ripgrep if available
    rgPath,

    async readFile(path: string): Promise<string> {
      const fullPath = path.startsWith("/")
        ? path
        : `${workingDirectory}/${path}`;
      const file = Bun.file(fullPath);
      return await file.text();
    },

    async writeFile(path: string, content: string): Promise<void> {
      const fullPath = path.startsWith("/")
        ? path
        : `${workingDirectory}/${path}`;
      await Bun.write(fullPath, content);
    },

    async readDir(path: string): Promise<string[]> {
      const fullPath = path.startsWith("/")
        ? path
        : `${workingDirectory}/${path}`;
      const fs = await import("fs/promises");
      return await fs.readdir(fullPath);
    },

    async fileExists(path: string): Promise<boolean> {
      const fullPath = path.startsWith("/")
        ? path
        : `${workingDirectory}/${path}`;
      // Use fs.stat instead of Bun.file for directory support
      const fs = await import("fs/promises");
      try {
        await fs.stat(fullPath);
        return true;
      } catch {
        return false;
      }
    },

    async isDirectory(path: string): Promise<boolean> {
      const fullPath = path.startsWith("/")
        ? path
        : `${workingDirectory}/${path}`;
      const fs = await import("fs/promises");
      try {
        const stat = await fs.stat(fullPath);
        return stat.isDirectory();
      } catch {
        return false;
      }
    },

    async destroy(): Promise<void> {
      // No cleanup needed for local sandbox
    },
  };
}
