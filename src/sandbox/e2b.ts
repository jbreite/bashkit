import { Sandbox as E2BSandboxSDK } from "@e2b/code-interpreter";
import type { ExecOptions, ExecResult, Sandbox } from "./interface";

export interface E2BSandboxConfig {
  apiKey?: string;
  /** Existing sandbox ID to reconnect to instead of creating new */
  sandboxId?: string;
  template?: string;
  timeout?: number;
  cwd?: string;
  metadata?: Record<string, string>;
}

export function createE2BSandbox(config: E2BSandboxConfig = {}): Sandbox {
  let sandbox: E2BSandboxSDK | null = null;
  let sandboxId: string | undefined = config.sandboxId;
  const workingDirectory = config.cwd || "/home/user";
  const timeout = config.timeout ?? 300000; // 5 minutes default

  const ensureSandbox = async (): Promise<E2BSandboxSDK> => {
    if (sandbox) return sandbox;

    if (config.sandboxId) {
      // Reconnect to existing sandbox
      sandbox = await E2BSandboxSDK.connect(config.sandboxId);
    } else {
      // Create new sandbox
      sandbox = await E2BSandboxSDK.create({
        apiKey: config.apiKey,
        timeoutMs: timeout,
        metadata: config.metadata,
      });
      sandboxId = sandbox.sandboxId;
    }

    return sandbox;
  };

  const exec = async (
    command: string,
    options?: ExecOptions,
  ): Promise<ExecResult> => {
    const sbx = await ensureSandbox();
    const startTime = performance.now();

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
        interrupted: false,
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

      // E2B SDK throws on non-zero exit codes - extract exit code from error
      if (error instanceof Error) {
        const exitMatch = error.message.match(/exit status (\d+)/i);
        const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : 1;
        return {
          stdout: "",
          stderr: error.message,
          exitCode,
          durationMs,
          interrupted: false,
        };
      }

      throw error;
    }
  };

  return {
    exec,

    get id() {
      return sandboxId;
    },

    async readFile(path: string): Promise<string> {
      // Use cat command instead of files.read() due to SDK issues
      const result = await exec(`cat "${path}"`);
      if (result.exitCode !== 0) {
        throw new Error(`Failed to read file: ${result.stderr}`);
      }
      return result.stdout;
    },

    async writeFile(path: string, content: string): Promise<void> {
      const sbx = await ensureSandbox();
      await sbx.files.write(path, content);
    },

    async readDir(path: string): Promise<string[]> {
      const result = await exec(`ls -1 "${path}"`);
      if (result.exitCode !== 0) {
        throw new Error(`Failed to read directory: ${result.stderr}`);
      }
      return result.stdout.split("\n").filter(Boolean);
    },

    async fileExists(path: string): Promise<boolean> {
      const result = await exec(`test -e "${path}"`);
      return result.exitCode === 0;
    },

    async isDirectory(path: string): Promise<boolean> {
      const result = await exec(`test -d "${path}"`);
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
