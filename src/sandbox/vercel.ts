import type { Sandbox as VercelSandboxType } from "@vercel/sandbox";
import type { ExecOptions, ExecResult, Sandbox } from "./interface";
import { createLazySingleton } from "./lazy-singleton";
import { ensureSandboxTools } from "./ensure-tools";

export interface VercelSandboxConfig {
  runtime?: "node22" | "python3.13";
  resources?: { vcpus: number };
  /** Existing sandbox ID to reconnect to instead of creating new */
  sandboxId?: string;
  timeout?: number;
  cwd?: string;
  teamId?: string;
  projectId?: string;
  token?: string;
  /**
   * Ensure tools like ripgrep are available in the sandbox.
   * Defaults to true. Set to false for faster startup if you don't need Grep.
   */
  ensureTools?: boolean;
}

export async function createVercelSandbox(
  config: VercelSandboxConfig = {},
): Promise<Sandbox> {
  let sandboxId: string | undefined = config.sandboxId;
  const workingDirectory = config.cwd || "/vercel/sandbox";
  const resolvedConfig = {
    runtime: config.runtime ?? "node22",
    resources: config.resources ?? { vcpus: 2 },
    timeout: config.timeout ?? 300000, // 5 minutes default
  } as const;

  // Lazy singleton prevents race condition with parallel tool calls
  const sandbox = createLazySingleton(async () => {
    // Dynamic import - only loads when actually needed
    let VercelSandboxSDK: typeof import("@vercel/sandbox").Sandbox;
    try {
      const module = await import("@vercel/sandbox");
      VercelSandboxSDK = module.Sandbox;
    } catch {
      throw new Error(
        "VercelSandbox requires @vercel/sandbox. Install with: npm install @vercel/sandbox",
      );
    }

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

    let sbx: VercelSandboxType;
    if (config.sandboxId) {
      // Reconnect to existing sandbox
      sbx = await VercelSandboxSDK.get({ sandboxId: config.sandboxId });
    } else {
      // Create new sandbox
      sbx = await VercelSandboxSDK.create(createOptions);
    }

    // Get sandbox ID from the SDK
    sandboxId = sbx.sandboxId;

    return sbx;
  });

  const exec = async (
    command: string,
    options?: ExecOptions,
  ): Promise<ExecResult> => {
    const sbx = await sandbox.get();
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

  // rgPath is set by ensureSandboxTools() after sandbox creation
  let rgPath: string | undefined;

  const sandboxObj: Sandbox = {
    exec,

    get id() {
      return sandboxId;
    },

    get rgPath() {
      return rgPath;
    },
    set rgPath(path: string | undefined) {
      rgPath = path;
    },

    async readFile(path: string): Promise<string> {
      const sbx = await sandbox.get();
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
      const sbx = await sandbox.get();
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
      try {
        const sbx = await sandbox.get();
        await sbx.stop();
      } catch {
        // Sandbox was never created, nothing to destroy
      }
      sandbox.reset();
    },
  };

  // Auto-setup tools if requested (default true)
  if (config.ensureTools !== false) {
    await ensureSandboxTools(sandboxObj);
  }

  return sandboxObj;
}
