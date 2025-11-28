import { Sandbox as E2BSandboxSDK } from "@e2b/code-interpreter";
import type { Sandbox, ExecOptions, ExecResult } from "./interface";

export interface E2BSandboxConfig {
  apiKey?: string;
  template?: string;
  timeout?: number;
  cwd?: string;
  metadata?: Record<string, string>;
}

export class E2BSandbox implements Sandbox {
  private sandbox: E2BSandboxSDK | null = null;
  private config: E2BSandboxConfig;
  private workingDirectory: string;

  constructor(
    config: E2BSandboxConfig = {},
    workingDirectory: string = "/home/user"
  ) {
    this.config = {
      timeout: 300000, // 5 minutes default
      ...config,
    };
    this.workingDirectory = config.cwd || workingDirectory;
  }

  private async ensureSandbox(): Promise<E2BSandboxSDK> {
    if (this.sandbox) return this.sandbox;

    this.sandbox = await E2BSandboxSDK.create({
      apiKey: this.config.apiKey,
      timeoutMs: this.config.timeout,
      metadata: this.config.metadata,
    });

    return this.sandbox;
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const sandbox = await this.ensureSandbox();
    const startTime = performance.now();
    let interrupted = false;

    try {
      const result = await sandbox.commands.run(command, {
        cwd: options?.cwd || this.workingDirectory,
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

      // Check if this was a timeout error
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
  }

  async readFile(path: string): Promise<string> {
    const sandbox = await this.ensureSandbox();
    const content = await sandbox.files.read(path);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const sandbox = await this.ensureSandbox();
    await sandbox.files.write(path, content);
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
      await this.sandbox.kill();
      this.sandbox = null;
    }
  }
}

