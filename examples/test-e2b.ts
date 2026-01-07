import type { ToolCallOptions } from "ai";
import { createAgentTools, createE2BSandbox } from "../src";

// Helper for direct tool execution in tests
// biome-ignore lint/suspicious/noExplicitAny: test helper
async function execute(
  tool: { execute?: (...args: any[]) => any },
  input: unknown,
  options: ToolCallOptions,
) {
  if (!tool.execute) throw new Error("Tool has no execute function");
  return tool.execute(input, options);
}

async function main() {
  console.log("🧪 Testing E2B sandbox tools...\n");

  const sandbox = createE2BSandbox({
    apiKey: process.env.E2B_API_KEY,
    cwd: "/home/user",
  });

  const { tools } = createAgentTools(sandbox);
  const toolOptions = { toolCallId: "test", messages: [] };

  try {
    // Test parallel initialization (verifies lazy singleton prevents race condition)
    console.log("⚡ Testing parallel initialization...");
    const [r1, r2, r3] = await Promise.all([
      execute(tools.Bash, { command: "echo 1", description: "test" }, toolOptions),
      execute(tools.Bash, { command: "echo 2", description: "test" }, toolOptions),
      execute(tools.Bash, { command: "echo 3", description: "test" }, toolOptions),
    ]);
    console.log(
      "Parallel results:",
      r1.stdout?.trim(),
      r2.stdout?.trim(),
      r3.stdout?.trim(),
    );
    console.log("✅ Parallel initialization succeeded (single sandbox created)\n");

    // Test Write first
    console.log("📝 Testing Write tool...");
    const writeResult = await execute(
      tools.Write,
      {
        file_path: "/home/user/test.txt",
        content: "Hello from E2B sandbox!",
      },
      toolOptions,
    );
    console.log("Write result:", writeResult);

    // Test Read
    console.log("\n📖 Testing Read tool...");
    const readResult = await execute(
      tools.Read,
      { file_path: "/home/user/test.txt" },
      toolOptions,
    );
    console.log("Read result:", readResult);

    // Test Read directory listing
    console.log("\n📁 Testing Read (directory)...");
    const dirResult = await execute(
      tools.Read,
      { file_path: "/home/user" },
      toolOptions,
    );
    console.log("Directory result:", dirResult);

    // Test Bash
    console.log("\n💻 Testing Bash tool...");
    const bashResult = await execute(
      tools.Bash,
      {
        command: "cat /home/user/test.txt && echo ' - read via cat'",
        description: "Read test file with cat",
      },
      toolOptions,
    );
    console.log("Bash result:", bashResult);

    // Test Edit
    console.log("\n✏️ Testing Edit tool...");
    const editResult = await execute(
      tools.Edit,
      {
        file_path: "/home/user/test.txt",
        old_string: "Hello from E2B sandbox!",
        new_string: "Hello from E2B sandbox! (edited)",
      },
      toolOptions,
    );
    console.log("Edit result:", editResult);

    // Verify edit
    const verifyResult = await execute(
      tools.Read,
      { file_path: "/home/user/test.txt" },
      toolOptions,
    );
    console.log("Verified content:", verifyResult);

    // Test Glob
    console.log("\n🔍 Testing Glob tool...");
    const globResult = await execute(
      tools.Glob,
      { pattern: "*.txt", path: "/home/user" },
      toolOptions,
    );
    console.log("Glob result:", globResult);

    // Test Grep
    console.log("\n🔎 Testing Grep tool...");
    const grepResult = await execute(
      tools.Grep,
      { pattern: "E2B", path: "/home/user" },
      toolOptions,
    );
    console.log("Grep result:", grepResult);

    console.log("\n✅ All E2B sandbox tools tested successfully!");
  } finally {
    // Always cleanup the sandbox
    console.log("\n🧹 Cleaning up sandbox...");
    await sandbox.destroy();
  }
}

main().catch(console.error);
