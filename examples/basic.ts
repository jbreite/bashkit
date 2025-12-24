/**
 * Basic example of using bashkit with the Vercel AI SDK
 *
 * Run with: bun run examples/basic.ts (with .env containing ANTHROPIC_API_KEY)
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, wrapLanguageModel } from "ai";
import {
  anthropicPromptCacheMiddleware,
  createAgentTools,
  createLocalSandbox,
  createTaskTool,
  createTodoWriteTool,
  type TodoState,
} from "../src";

async function main() {
  // Create sandbox in a temp directory
  const sandbox = createLocalSandbox({ cwd: "/tmp/bashkit-test" });

  // Create sandbox-based tools
  const { tools: sandboxTools } = createAgentTools(sandbox);

  // Create state for todos
  const todoState: TodoState = { todos: [] };
  const todoTool = createTodoWriteTool(todoState, undefined, (todos) => {
    console.log("📝 Todos updated:", JSON.stringify(todos, null, 2));
  });

  // Wrap model with prompt caching middleware for better performance
  const model = wrapLanguageModel({
    model: anthropic("claude-sonnet-4-20250514"),
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
    TodoWrite: todoTool,
    Task: taskTool,
  };

  console.log("🚀 Starting bashkit test...\n");
  console.log("Available tools:", Object.keys(tools).join(", "));
  console.log("Prompt caching: enabled");
  console.log(`\n${"=".repeat(60)}\n`);

  let stepNumber = 0;

  // Run the agent with logging
  const result = await generateText({
    model,
    tools,
    system: `You are a helpful coding assistant with access to tools for file operations and code execution.
    
When given a task:
1. Use TodoWrite to plan your steps
2. Execute each step using the appropriate tools
3. Mark todos as completed as you go`,
    prompt: `Create a simple "hello world" TypeScript file at /tmp/bashkit-test/hello.ts and then run it with bun.`,
    stopWhen: stepCountIs(10), // Allow up to 10 steps
    onStepFinish: ({ finishReason, toolCalls, toolResults, text, usage }) => {
      stepNumber++;
      console.log(`\n📍 Step ${stepNumber} (${finishReason})`);

      if (toolCalls && toolCalls.length > 0) {
        for (const call of toolCalls) {
          console.log(`   🔧 Tool: ${call.toolName}`);
          const inputStr = JSON.stringify(call.input, null, 2);
          console.log(`      Input: ${inputStr.split("\n").join("\n      ")}`);
        }
      }

      if (toolResults && toolResults.length > 0) {
        for (const res of toolResults) {
          const outputStr = JSON.stringify(res.output, null, 2);
          const truncated =
            outputStr.length > 300
              ? `${outputStr.slice(0, 300)}...`
              : outputStr;
          console.log(
            `   ✅ Result: ${truncated.split("\n").join("\n      ")}`,
          );
        }
      }

      if (text) {
        console.log(
          `   💬 Text: ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`,
        );
      }

      if (usage) {
        console.log(
          `   📊 Tokens: in=${usage.inputTokens} out=${usage.outputTokens}`,
        );
      }
    },
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log("\n✅ Agent completed!\n");
  console.log("Final response:", result.text || "(no text response)");
  console.log("\n📈 Summary:");
  console.log("   Steps:", result.steps.length);
  console.log("   Input tokens:", result.usage.inputTokens);
  console.log("   Output tokens:", result.usage.outputTokens);

  const cacheCreation =
    result.providerMetadata?.anthropic?.cacheCreationInputTokens;
  const cacheRead = result.providerMetadata?.anthropic?.cacheReadInputTokens;
  if (cacheCreation || cacheRead) {
    console.log("   Cache creation:", cacheCreation || 0);
    console.log("   Cache read:", cacheRead || 0);
  }

  // Cleanup
  await sandbox.destroy();
}

main().catch(console.error);
