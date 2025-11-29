import { Sandbox as E2BSandboxSDK } from "@e2b/code-interpreter";
import type { Sandbox, ExecOptions, ExecResult } from "./interface";

export interface E2BSandboxConfig {
  apiKey?: string;
  template?: string;
  timeout?: number;
  cwd?: string;
  metadata?: Record<string, string>;
}

export function createE2BSandbox(config: E2BSandboxConfig = {}): Sandbox {
  let sandbox: E2BSandboxSDK | null = null;
  const workingDirectory = config.cwd || "/home/user";
  const timeout = config.timeout ?? 300000; // 5 minutes default

  const ensureSandbox = async (): Promise<E2BSandboxSDK> => {
    if (sandbox) return sandbox;

    sandbox = await E2BSandboxSDK.create({
      apiKey: config.apiKey,
      timeoutMs: timeout,
      metadata: config.metadata,
    });

    return sandbox;
  };

  const exec = async (
    command: string,
    options?: ExecOptions
  ): Promise<ExecResult> => {
    const sbx = await ensureSandbox();
    const startTime = performance.now();
    let interrupted = false;

    try {
      const result = await sbx.commands.run(command, {
        cwd: options?.cwd || workingDirectory,
        timeoutMs: options?.timeout,
      });

      const durationMs = Math.round(performance.now() - startTime);

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs,
        interrupted,
      };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);

      if (
        error instanceof Error &&
        error.message.toLowerCase().includes("timeout")
      ) {
        return {
          stdout: "",
          stderr: "Command timed out",
          exitCode: 124,
          durationMs,
          interrupted: true,
        };
      }

      throw error;
    }
  };

  return {
    exec,

    async readFile(path: string): Promise<string> {
      const sbx = await ensureSandbox();
      try {
        return await sbx.files.read(path);
      } catch (error) {
        // Log detailed error info for debugging
        console.error("[E2B readFile] Error reading:", path);
        console.error("[E2B readFile] Error type:", error?.constructor?.name);
        console.error("[E2B readFile] Error message:", error instanceof Error ? error.message : error);
        console.error("[E2B readFile] Full error:", error);
        throw error;
      }
    },

    async writeFile(path: string, content: string): Promise<void> {
      const sbx = await ensureSandbox();
      await sbx.files.write(path, content);
    },

    async readDir(path: string): Promise<string[]> {
      const result = await exec(`ls -1 ${path}`);
      if (result.exitCode !== 0) {
        throw new Error(`Failed to read directory: ${result.stderr}`);
      }
      return result.stdout.split("\n").filter(Boolean);
    },

    async fileExists(path: string): Promise<boolean> {
      const result = await exec(`test -e ${path}`);
      return result.exitCode === 0;
    },

    async isDirectory(path: string): Promise<boolean> {
      const result = await exec(`test -d ${path}`);
      return result.exitCode === 0;
    },

    async destroy(): Promise<void> {
      if (sandbox) {
        await sandbox.kill();
        sandbox = null;
      }
    },
  };
}
