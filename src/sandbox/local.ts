import type { Sandbox, ExecOptions, ExecResult } from "./interface";

export interface LocalSandboxConfig {
  cwd?: string;
}

export function createLocalSandbox(config: LocalSandboxConfig = {}): Sandbox {
  const workingDirectory = config.cwd || "/tmp";

  const exec = async (
    command: string,
    options?: ExecOptions
  ): Promise<ExecResult> => {
    const startTime = performance.now();
    let interrupted = false;

    const proc = Bun.spawn(["bash", "-c", command], {
      cwd: options?.cwd || workingDirectory,
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

  async readFile(path: string): Promise<string> {
    const file = Bun.file(path);
    return await file.text();
    },

  async writeFile(path: string, content: string): Promise<void> {
    await Bun.write(path, content);
    },

  async readDir(path: string): Promise<string[]> {
    const fs = await import("fs/promises");
    return await fs.readdir(path);
    },

  async fileExists(path: string): Promise<boolean> {
    const file = Bun.file(path);
    return await file.exists();
    },

  async isDirectory(path: string): Promise<boolean> {
    const fs = await import("fs/promises");
    try {
      const stat = await fs.stat(path);
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
