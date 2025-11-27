import { Sandbox as VercelSandboxSDK } from "@vercel/sandbox";
import type { Sandbox, ExecOptions, ExecResult } from "./interface";

export interface VercelSandboxConfig {
  runtime?: "node22" | "python3.13";
  resources?: { vcpus: number };
  timeout?: number;
  teamId?: string;
  projectId?: string;
  token?: string;
}

export class VercelSandbox implements Sandbox {
  private sandbox: VercelSandboxSDK | null = null;
  private config: VercelSandboxConfig;
  private workingDirectory: string;

  constructor(
    config: VercelSandboxConfig = {},
    workingDirectory: string = "/vercel/sandbox"
  ) {
    this.config = {
      runtime: "node22",
      resources: { vcpus: 2 },
      timeout: 300000, // 5 minutes default
      ...config,
    };
    this.workingDirectory = workingDirectory;
  }

  private async ensureSandbox(): Promise<VercelSandboxSDK> {
    if (this.sandbox) return this.sandbox;

    const createOptions: Parameters<typeof VercelSandboxSDK.create>[0] = {
      runtime: this.config.runtime,
      resources: this.config.resources,
      timeout: this.config.timeout,
    };

    // Add auth if provided
    if (this.config.teamId && this.config.token) {
      Object.assign(createOptions, {
        teamId: this.config.teamId,
        token: this.config.token,
      });
    }

    this.sandbox = await VercelSandboxSDK.create(createOptions);
    return this.sandbox;
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const sandbox = await this.ensureSandbox();
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
      const result = await sandbox.runCommand({
        cmd: "bash",
        args: ["-c", command],
        cwd: options?.cwd || this.workingDirectory,
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
  }

  async readFile(path: string): Promise<string> {
    const sandbox = await this.ensureSandbox();
    const stream = await sandbox.readFile({ path });

    if (!stream) {
      throw new Error(`File not found: ${path}`);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const sandbox = await this.ensureSandbox();
    await sandbox.writeFiles([
      {
        path,
        content: Buffer.from(content, "utf-8"),
      },
    ]);
  }

  async readDir(path: string): Promise<string[]> {
    const result = await this.exec(`ls -1 ${path}`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read directory: ${result.stderr}`);
    }
    return result.stdout.split("\n").filter(Boolean);
  }

  async fileExists(path: string): Promise<boolean> {
    const result = await this.exec(`test -e ${path}`);
    return result.exitCode === 0;
  }

  async isDirectory(path: string): Promise<boolean> {
    const result = await this.exec(`test -d ${path}`);
    return result.exitCode === 0;
  }

  async destroy(): Promise<void> {
    if (this.sandbox) {
      await this.sandbox.stop();
      this.sandbox = null;
    }
  }
}
