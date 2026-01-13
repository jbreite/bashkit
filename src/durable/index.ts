/**
 * bashkit/durable - Durable agent sessions with Cloudflare Agents SDK
 *
 * This module provides sandbox-integrated agents built on the Cloudflare Agents SDK.
 * It extends the Agent class with automatic sandbox lifecycle management.
 *
 * @example
 * ```typescript
 * import { BashKitAgent, createBashKitAgent } from 'bashkit/durable';
 * import { createE2BSandbox } from 'bashkit';
 *
 * // Option 1: Extend BashKitAgent directly
 * export class MyAgent extends BashKitAgent<Env> {
 *   sandboxConfig = {
 *     create: () => createE2BSandbox({ apiKey: this.env.E2B_API_KEY }),
 *     reconnect: (id) => createE2BSandbox({ apiKey: this.env.E2B_API_KEY, sandboxId: id }),
 *   };
 *
 *   async onMessage(connection, message) {
 *     const result = await this.sandbox.commands.run('echo hello');
 *     connection.send(JSON.stringify({ output: result.stdout }));
 *   }
 * }
 *
 * // Option 2: Use factory function
 * const BaseBashKitAgent = createBashKitAgent({
 *   sandbox: {
 *     create: (env) => createE2BSandbox({ apiKey: env.E2B_API_KEY }),
 *     reconnect: (id, env) => createE2BSandbox({ apiKey: env.E2B_API_KEY, sandboxId: id }),
 *   },
 * });
 *
 * export class MyAgent extends BaseBashKitAgent {
 *   async onMessage(connection, message) {
 *     // Your agent logic
 *   }
 * }
 * ```
 */

// Main exports
export {
  // Base agent (manual message handling)
  BashKitAgent,
  createBashKitAgent,
  // Chat agent (built-in chat handling with useAgentChat support)
  BashKitChatAgent,
  createBashKitChatAgent,
  // Re-exported from agents SDK
  Agent,
  AIChatAgent,
} from "./durable-session";

// Types
export type {
  BashKitAgentConfig,
  Connection,
  ConnectionContext,
  WSMessage,
} from "./durable-session";
