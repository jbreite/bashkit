/**
 * Test E2B sandbox tools directly (no AI needed)
 *
 * Run with: E2B_API_KEY=your_key bun run examples/test-e2b.ts
 */

import { createAgentTools, createE2BSandbox } from "../src";

async function main() {
  console.log("🧪 Testing E2B sandbox tools...\n");

  const sandbox = createE2BSandbox({
    apiKey: process.env.E2B_API_KEY,
    cwd: "/home/user",
  });

  const tools = createAgentTools(sandbox);
  const toolOptions = { toolCallId: "test", messages: [] };

  try {
    // Test Write first
    console.log("📝 Testing Write tool...");
    const writeResult = await tools.Write.execute!(
      {
        file_path: "/home/user/test.txt",
        content: "Hello from E2B sandbox!",
      },
      toolOptions,
    );
    console.log("Write result:", writeResult);

    // Test Read
    console.log("\n📖 Testing Read tool...");
    const readResult = await tools.Read.execute!(
      { file_path: "/home/user/test.txt" },
      toolOptions,
    );
    console.log("Read result:", readResult);

    // Test Read directory listing
    console.log("\n📁 Testing Read (directory)...");
    const dirResult = await tools.Read.execute!(
      { file_path: "/home/user" },
      toolOptions,
    );
    console.log("Directory result:", dirResult);

    // Test Bash
    console.log("\n💻 Testing Bash tool...");
    const bashResult = await tools.Bash.execute!(
      {
        command: "cat /home/user/test.txt && echo ' - read via cat'",
        description: "Read test file with cat",
      },
      toolOptions,
    );
    console.log("Bash result:", bashResult);

    // Test Edit
    console.log("\n✏️ Testing Edit tool...");
    const editResult = await tools.Edit.execute!(
      {
        file_path: "/home/user/test.txt",
        old_string: "Hello from E2B sandbox!",
        new_string: "Hello from E2B sandbox! (edited)",
      },
      toolOptions,
    );
    console.log("Edit result:", editResult);

    // Verify edit
    const verifyResult = await tools.Read.execute!(
      { file_path: "/home/user/test.txt" },
      toolOptions,
    );
    console.log("Verified content:", verifyResult);

    // Test Glob
    console.log("\n🔍 Testing Glob tool...");
    const globResult = await tools.Glob.execute!(
      { pattern: "*.txt", path: "/home/user" },
      toolOptions,
    );
    console.log("Glob result:", globResult);

    // Test Grep
    console.log("\n🔎 Testing Grep tool...");
    const grepResult = await tools.Grep.execute!(
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

