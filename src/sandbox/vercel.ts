import { Sandbox as VercelSandboxSDK } from "@vercel/sandbox";
import type { ExecOptions, ExecResult, Sandbox } from "./interface";

export interface VercelSandboxConfig {
  runtime?: "node22" | "python3.13";
  resources?: { vcpus: number };
  timeout?: number;
  cwd?: string;
  teamId?: string;
  projectId?: string;
  token?: string;
}

export function createVercelSandbox(config: VercelSandboxConfig = {}): Sandbox {
  let sandbox: VercelSandboxSDK | null = null;
  const workingDirectory = config.cwd || "/vercel/sandbox";
  const resolvedConfig = {
    runtime: config.runtime ?? "node22",
    resources: config.resources ?? { vcpus: 2 },
    timeout: config.timeout ?? 300000, // 5 minutes default
  } as const;

  const ensureSandbox = async (): Promise<VercelSandboxSDK> => {
    if (sandbox) return sandbox;

    const createOptions: Parameters<typeof VercelSandboxSDK.create>[0] = {
      runtime: resolvedConfig.runtime,
      resources: resolvedConfig.resources,
      timeout: resolvedConfig.timeout,
    };

    if (config.teamId && config.token) {
      Object.assign(createOptions, {
        teamId: config.teamId,
        token: config.token,
      });
    }

    sandbox = await VercelSandboxSDK.create(createOptions);
    return sandbox;
  };

  const exec = async (
    command: string,
    options?: ExecOptions,
  ): Promise<ExecResult> => {
    const sbx = await ensureSandbox();
    const startTime = performance.now();
    let interrupted = false;

    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (options?.timeout) {
      timeoutId = setTimeout(() => {
        interrupted = true;
        abortController.abort();
      }, options.timeout);
    }

    try {
      const result = await sbx.runCommand({
        cmd: "bash",
        args: ["-c", command],
        cwd: options?.cwd || workingDirectory,
        signal: abortController.signal,
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      const stdout = await result.stdout();
      const stderr = await result.stderr();
      const durationMs = Math.round(performance.now() - startTime);

      return {
        stdout,
        stderr,
        exitCode: result.exitCode,
        durationMs,
        interrupted,
      };
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      const durationMs = Math.round(performance.now() - startTime);

      if (interrupted) {
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
      const stream = await sbx.readFile({ path });

      if (!stream) {
        throw new Error(`File not found: ${path}`);
      }

      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf-8");
    },

    async writeFile(path: string, content: string): Promise<void> {
      const sbx = await ensureSandbox();
      await sbx.writeFiles([
        {
          path,
          content: Buffer.from(content, "utf-8"),
        },
      ]);
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
        await sandbox.stop();
        sandbox = null;
      }
    },
  };
}
