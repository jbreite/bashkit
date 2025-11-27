/**
 * Basic example of using bashkit with the Vercel AI SDK
 *
 * Run with: ANTHROPIC_API_KEY=your-key bun run examples/basic.ts
 */

import { generateText, wrapLanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  createAgentTools,
  createTaskTool,
  createTodoWriteTool,
  LocalSandbox,
  anthropicPromptCacheMiddleware,
  type TodoState,
} from "../src";

async function main() {
  // Create sandbox in a temp directory
  const sandbox = new LocalSandbox("/tmp/bashkit-test");

  // Create sandbox-based tools
  const sandboxTools = createAgentTools(sandbox);

  // Create state for todos
  const todoState: TodoState = { todos: [] };
  const todoTool = createTodoWriteTool(todoState, undefined, (todos) => {
    console.log("📝 Todos updated:", todos);
  });

  // Wrap model with prompt caching middleware for better performance
  const model = wrapLanguageModel({
    model: anthropic("claude-haiku-4.5"),
    middleware: anthropicPromptCacheMiddleware,
  });

  // Create task tool for sub-agents (also uses cached model)
  const taskTool = createTaskTool({
    model,
    tools: sandboxTools,
    subagentTypes: {
      research: {
        systemPrompt: "You are a research specialist. Find information only.",
        tools: ["Read", "Grep", "Glob"],
      },
      coding: {
        systemPrompt: "You are a coding expert. Write clean code.",
        tools: ["Read", "Write", "Edit", "Bash"],
      },
    },
  });

  // Combine all tools
  const tools = {
    ...sandboxTools,
    TodoWrite: todoTool!,
    Task: taskTool,
  };

  console.log("🚀 Starting bashkit test...\n");
  console.log("Available tools:", Object.keys(tools).join(", "));
  console.log("Prompt caching: enabled");
  console.log("");

  // Run the agent
  const result = await generateText({
    model,
    tools,
    system: `You are a helpful coding assistant with access to tools for file operations and code execution.
    
When given a task:
1. Use TodoWrite to plan your steps
2. Execute each step using the appropriate tools
3. Mark todos as completed as you go`,
    prompt: `Create a simple "hello world" TypeScript file at /tmp/bashkit-test/hello.ts and then run it with bun.`,
  });

  console.log("\n✅ Agent completed!\n");
  console.log("Final response:", result.text);
  console.log("\nSteps taken:", result.steps.length);
  console.log("Usage:", {
    input: result.usage.inputTokens,
    output: result.usage.outputTokens,
    cacheCreation: result.providerMetadata?.anthropic?.cacheCreationInputTokens,
    cacheRead: result.providerMetadata?.anthropic?.cacheReadInputTokens,
  });

  // Cleanup
  await sandbox.destroy();
}

main().catch(console.error);
