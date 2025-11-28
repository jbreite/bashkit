/**
 * Test the tools directly without AI (no API key needed)
 *
 * Run with: bun run examples/test-tools.ts
 */

import { createAgentTools, createLocalSandbox } from "../src";

async function main() {
  console.log("🧪 Testing bashkit tools directly...\n");

  const sandbox = createLocalSandbox({ cwd: "/tmp/bashkit-test" });
  const tools = createAgentTools(sandbox);

  const toolOptions = { toolCallId: "test", messages: [] };

  // Test Write
  console.log("📝 Testing Write tool...");
  const writeResult = await tools.Write.execute!(
    {
      file_path: "/tmp/bashkit-test/test.ts",
      content: 'console.log("Hello from bashkit!");',
    },
    toolOptions
  );
  console.log("Write result:", writeResult);

  // Test Read
  console.log("\n📖 Testing Read tool...");
  const readResult = await tools.Read.execute!(
    { file_path: "/tmp/bashkit-test/test.ts" },
    toolOptions
  );
  console.log("Read result:", readResult);

  // Test Bash
  console.log("\n💻 Testing Bash tool...");
  const bashResult = await tools.Bash.execute!(
    {
      command: "bun run /tmp/bashkit-test/test.ts",
      description: "Run test file",
    },
    toolOptions
  );
  console.log("Bash result:", bashResult);

  // Test Edit
  console.log("\n✏️ Testing Edit tool...");
  const editResult = await tools.Edit.execute!(
    {
      file_path: "/tmp/bashkit-test/test.ts",
      old_string: "Hello from bashkit!",
      new_string: "Hello from bashkit! (edited)",
    },
    toolOptions
  );
  console.log("Edit result:", editResult);

  // Verify edit
  const verifyResult = await tools.Read.execute!(
    { file_path: "/tmp/bashkit-test/test.ts" },
    toolOptions
  );
  console.log("Verified content:", verifyResult);

  // Test Glob
  console.log("\n🔍 Testing Glob tool...");
  const globResult = await tools.Glob.execute!(
    { pattern: "*.ts", path: "/tmp/bashkit-test" },
    toolOptions
  );
  console.log("Glob result:", globResult);

  // Test Grep
  console.log("\n🔎 Testing Grep tool...");
  const grepResult = await tools.Grep.execute!(
    { pattern: "bashkit", path: "/tmp/bashkit-test" },
    toolOptions
  );
  console.log("Grep result:", grepResult);

  console.log("\n✅ All tools tested successfully!");

  await sandbox.destroy();
}

main().catch(console.error);
