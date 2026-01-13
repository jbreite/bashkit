import { Agent } from "agents";
import { AIChatAgent } from "agents/ai-chat-agent";
import type { Connection, ConnectionContext, WSMessage } from "agents";
import type { Sandbox } from "../sandbox/interface";

/**
 * Configuration for creating a BashKit agent with sandbox support.
 */
export interface BashKitAgentConfig<TEnv = unknown> {
  /**
   * Sandbox lifecycle configuration.
   */
  sandbox: {
    /**
     * Create a new sandbox instance.
     */
    create: (env: TEnv) => Promise<Sandbox>;

    /**
     * Reconnect to an existing sandbox by ID.
     */
    reconnect: (sandboxId: string, env: TEnv) => Promise<Sandbox>;
  };
}

/**
 * Base class for BashKit agents with sandbox support.
 * Extends the Cloudflare Agents SDK Agent class.
 *
 * @example
 * ```typescript
 * import { BashKitAgent } from 'bashkit/durable';
 * import { createE2BSandbox } from 'bashkit';
 *
 * export class MyAgent extends BashKitAgent<Env> {
 *   getSandboxConfig() {
 *     return {
 *       create: () => createE2BSandbox({ apiKey: this.env.E2B_API_KEY }),
 *       reconnect: (id) => createE2BSandbox({ apiKey: this.env.E2B_API_KEY, sandboxId: id }),
 *     };
 *   }
 *
 *   async onMessage(connection: Connection, message: WSMessage) {
 *     // Access sandbox via this.getSandbox()
 *     const sandbox = this.getSandbox();
 *     const result = await sandbox.commands.run('echo hello');
 *     connection.send(JSON.stringify({ output: result.stdout }));
 *   }
 * }
 * ```
 */
export abstract class BashKitAgent<
  TEnv = unknown,
  TState = unknown,
> extends Agent<TEnv, TState> {
  /**
   * Environment bindings (typed from generic).
   * Exposed from parent class for TypeScript access.
   */
  declare env: TEnv;

  /**
   * The sandbox instance. Available after onStart() completes.
   */
  private _sandbox: Sandbox | null = null;

  /**
   * Override this to configure sandbox creation/reconnection.
   * Called with access to this.env.
   */
  protected abstract getSandboxConfig(): BashKitAgentConfig<TEnv>["sandbox"];

  /**
   * Called when the agent starts. Initializes the sandbox.
   */
  async onStart(): Promise<void> {
    this.ensureSchema();
    await this.initSandbox();
  }

  /**
   * Initialize or reconnect to sandbox.
   */
  private async initSandbox(): Promise<void> {
    const config = this.getSandboxConfig();

    // Check for existing sandbox ID using this.sql
    let existingSandboxId: string | null = null;
    try {
      const rows = this.sql<{ sandbox_id: string | null }>`
        SELECT sandbox_id FROM _bashkit_sandbox WHERE id = 1
      `;
      existingSandboxId = rows[0]?.sandbox_id ?? null;
    } catch {
      // Table might not exist yet, that's ok
    }

    if (existingSandboxId) {
      try {
        this._sandbox = await config.reconnect(existingSandboxId, this.env);
        console.log(`[bashkit] Reconnected to sandbox: ${existingSandboxId}`);
      } catch (error) {
        console.warn(
          `[bashkit] Failed to reconnect to sandbox ${existingSandboxId}, creating new:`,
          error,
        );
        await this.createNewSandbox(config);
      }
    } else {
      await this.createNewSandbox(config);
    }
  }

  /**
   * Create a new sandbox and persist its ID.
   */
  private async createNewSandbox(
    config: BashKitAgentConfig<TEnv>["sandbox"],
  ): Promise<void> {
    this._sandbox = await config.create(this.env);

    if (this._sandbox.id) {
      const now = Date.now();
      const sandboxId = this._sandbox.id;
      this.sql`
        INSERT INTO _bashkit_sandbox (id, sandbox_id, status, created_at, updated_at)
        VALUES (1, ${sandboxId}, 'active', ${now}, ${now})
        ON CONFLICT(id) DO UPDATE SET
          sandbox_id = ${sandboxId},
          updated_at = ${now}
      `;
      console.log(`[bashkit] Created new sandbox: ${this._sandbox.id}`);
    }
  }

  /**
   * Ensure schema exists. Called automatically in onStart.
   */
  private ensureSchema(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS _bashkit_sandbox (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        sandbox_id TEXT,
        status TEXT DEFAULT 'active',
        created_at INTEGER,
        updated_at INTEGER
      )
    `;
  }

  /**
   * Get the current sandbox, throwing if not initialized.
   */
  protected getSandbox(): Sandbox {
    if (!this._sandbox) {
      throw new Error(
        "Sandbox not initialized. Wait for onStart() to complete.",
      );
    }
    return this._sandbox;
  }

  /**
   * Check if sandbox is initialized.
   */
  protected hasSandbox(): boolean {
    return this._sandbox !== null;
  }
}

/**
 * Factory function to create a BashKit agent class with sandbox support.
 * This is an alternative to extending BashKitAgent directly.
 *
 * @example
 * ```typescript
 * import { createBashKitAgent } from 'bashkit/durable';
 * import { createE2BSandbox } from 'bashkit';
 *
 * const BaseBashKitAgent = createBashKitAgent<Env>({
 *   sandbox: {
 *     create: (env) => createE2BSandbox({ apiKey: env.E2B_API_KEY }),
 *     reconnect: (id, env) => createE2BSandbox({ apiKey: env.E2B_API_KEY, sandboxId: id }),
 *   },
 * });
 *
 * export class MyAgent extends BaseBashKitAgent {
 *   async onMessage(connection, message) {
 *     const sandbox = this.getSandbox();
 *     const result = await sandbox.commands.run('echo hello');
 *     connection.send(JSON.stringify({ output: result.stdout }));
 *   }
 * }
 * ```
 */
export function createBashKitAgent<TEnv = unknown, TState = unknown>(
  config: BashKitAgentConfig<TEnv>,
): typeof BashKitAgent<TEnv, TState> {
  abstract class ConfiguredBashKitAgent extends BashKitAgent<TEnv, TState> {
    protected getSandboxConfig() {
      return config.sandbox;
    }
  }

  return ConfiguredBashKitAgent as typeof BashKitAgent<TEnv, TState>;
}

/**
 * Base class for BashKit chat agents with sandbox support.
 * Extends AIChatAgent for built-in chat handling + adds sandbox lifecycle management.
 *
 * Use this when building chat-based agents that need sandbox access.
 * You get:
 * - `this.messages` - automatic chat history
 * - `onChatMessage()` - implement to handle chat, return streaming response
 * - `getSandbox()` - access the E2B sandbox
 * - Resumable streaming out of the box
 * - Works with `useAgentChat` on the frontend
 *
 * @example
 * ```typescript
 * import { BashKitChatAgent } from 'bashkit/durable';
 * import { createE2BSandbox, createAgentTools } from 'bashkit';
 * import { streamText } from 'ai';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * export class MyChatAgent extends BashKitChatAgent<Env> {
 *   getSandboxConfig() {
 *     return {
 *       create: () => createE2BSandbox({ apiKey: this.env.E2B_API_KEY }),
 *       reconnect: (id) => createE2BSandbox({ apiKey: this.env.E2B_API_KEY, sandboxId: id }),
 *     };
 *   }
 *
 *   async onChatMessage() {
 *     const sandbox = this.getSandbox();
 *     const tools = createAgentTools(sandbox);
 *
 *     return streamText({
 *       model: anthropic('claude-sonnet-4-20250514'),
 *       messages: this.messages,
 *       tools,
 *     }).toUIMessageStreamResponse();
 *   }
 * }
 * ```
 */
export abstract class BashKitChatAgent<
  TEnv = unknown,
  TState = unknown,
> extends AIChatAgent<TEnv, TState> {
  /**
   * Environment bindings (typed from generic).
   */
  declare env: TEnv;

  /**
   * The sandbox instance. Available after onStart() completes.
   */
  private _sandbox: Sandbox | null = null;

  /**
   * Override this to configure sandbox creation/reconnection.
   */
  protected abstract getSandboxConfig(): BashKitAgentConfig<TEnv>["sandbox"];

  /**
   * Called when the agent starts. Initializes the sandbox.
   * If you override this, make sure to call super.onStart().
   */
  async onStart(): Promise<void> {
    this.ensureSandboxSchema();
    await this.initSandbox();
  }

  /**
   * Initialize or reconnect to sandbox.
   */
  private async initSandbox(): Promise<void> {
    const config = this.getSandboxConfig();

    // Check for existing sandbox ID
    let existingSandboxId: string | null = null;
    try {
      const rows = this.sql<{ sandbox_id: string | null }>`
        SELECT sandbox_id FROM _bashkit_sandbox WHERE id = 1
      `;
      existingSandboxId = rows[0]?.sandbox_id ?? null;
    } catch {
      // Table might not exist yet
    }

    if (existingSandboxId) {
      try {
        this._sandbox = await config.reconnect(existingSandboxId, this.env);
        console.log(`[bashkit] Reconnected to sandbox: ${existingSandboxId}`);
      } catch (error) {
        console.warn(
          `[bashkit] Failed to reconnect to sandbox ${existingSandboxId}, creating new:`,
          error,
        );
        await this.createNewSandbox(config);
      }
    } else {
      await this.createNewSandbox(config);
    }
  }

  /**
   * Create a new sandbox and persist its ID.
   */
  private async createNewSandbox(
    config: BashKitAgentConfig<TEnv>["sandbox"],
  ): Promise<void> {
    this._sandbox = await config.create(this.env);

    if (this._sandbox.id) {
      const now = Date.now();
      const sandboxId = this._sandbox.id;
      this.sql`
        INSERT INTO _bashkit_sandbox (id, sandbox_id, status, created_at, updated_at)
        VALUES (1, ${sandboxId}, 'active', ${now}, ${now})
        ON CONFLICT(id) DO UPDATE SET
          sandbox_id = ${sandboxId},
          updated_at = ${now}
      `;
      console.log(`[bashkit] Created new sandbox: ${this._sandbox.id}`);
    }
  }

  /**
   * Ensure sandbox schema exists.
   */
  private ensureSandboxSchema(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS _bashkit_sandbox (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        sandbox_id TEXT,
        status TEXT DEFAULT 'active',
        created_at INTEGER,
        updated_at INTEGER
      )
    `;
  }

  /**
   * Get the current sandbox, throwing if not initialized.
   */
  protected getSandbox(): Sandbox {
    if (!this._sandbox) {
      throw new Error(
        "Sandbox not initialized. Wait for onStart() to complete.",
      );
    }
    return this._sandbox;
  }

  /**
   * Check if sandbox is initialized.
   */
  protected hasSandbox(): boolean {
    return this._sandbox !== null;
  }
}

/**
 * Factory function to create a BashKit chat agent class with sandbox support.
 *
 * @example
 * ```typescript
 * import { createBashKitChatAgent } from 'bashkit/durable';
 * import { createE2BSandbox, createAgentTools } from 'bashkit';
 *
 * const BaseChatAgent = createBashKitChatAgent<Env>({
 *   sandbox: {
 *     create: (env) => createE2BSandbox({ apiKey: env.E2B_API_KEY }),
 *     reconnect: (id, env) => createE2BSandbox({ apiKey: env.E2B_API_KEY, sandboxId: id }),
 *   },
 * });
 *
 * export class MyChatAgent extends BaseChatAgent {
 *   async onChatMessage() {
 *     const tools = createAgentTools(this.getSandbox());
 *     return streamText({ ... }).toUIMessageStreamResponse();
 *   }
 * }
 * ```
 */
export function createBashKitChatAgent<TEnv = unknown, TState = unknown>(
  config: BashKitAgentConfig<TEnv>,
): typeof BashKitChatAgent<TEnv, TState> {
  abstract class ConfiguredBashKitChatAgent extends BashKitChatAgent<
    TEnv,
    TState
  > {
    protected getSandboxConfig() {
      return config.sandbox;
    }
  }

  return ConfiguredBashKitChatAgent as typeof BashKitChatAgent<TEnv, TState>;
}

// Re-export Agent types from the SDK for convenience
export type { Connection, ConnectionContext, WSMessage };
export { Agent } from "agents";
export { AIChatAgent } from "agents/ai-chat-agent";
