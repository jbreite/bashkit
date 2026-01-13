/**
 * bashkit/react - React hooks for connecting to BashKit agents
 *
 * This module re-exports hooks from the Cloudflare Agents SDK for connecting
 * to agents from React applications.
 *
 * @example
 * ```tsx
 * import { useAgent, useAgentChat } from 'bashkit/react';
 *
 * function Chat() {
 *   // Connect to the agent
 *   const agent = useAgent({
 *     agent: 'my-agent',
 *     name: sessionId,
 *   });
 *
 *   // Use the chat hook for AI conversations
 *   const { messages, input, handleSubmit, handleInputChange } = useAgentChat({
 *     agent,
 *   });
 *
 *   return (
 *     <div>
 *       {messages.map((msg, i) => (
 *         <div key={i}>
 *           <strong>{msg.role}:</strong> {msg.content}
 *         </div>
 *       ))}
 *       <form onSubmit={handleSubmit}>
 *         <input value={input} onChange={handleInputChange} />
 *         <button type="submit">Send</button>
 *       </form>
 *     </div>
 *   );
 * }
 * ```
 */

// Re-export hooks from Cloudflare Agents SDK
export { useAgent } from "agents/react";
export { useAgentChat } from "agents/ai-react";

// Re-export client utilities
export { AgentClient, agentFetch } from "agents/client";

// Re-export types
export type { UseAgentOptions } from "agents/react";
