import type { ToolExecutionOptions } from "ai";
import { createAgentTools, createLocalSandbox } from "../src";

// Helper for direct tool execution in tests
async function execute(
  // biome-ignore lint/suspicious/noExplicitAny: <explanation test right now>
  tool: { execute?: (...args: any[]) => any },
  input: unknown,
  options: ToolExecutionOptions,
) {
  if (!tool.execute) throw new Error("Tool has no execute function");
  return tool.execute(input, options);
}

async function main() {
  console.log("🧪 Testing bashkit tools directly...\n");

  const sandbox = createLocalSandbox({ cwd: "/tmp/bashkit-test" });
  const { tools } = await createAgentTools(sandbox);

  const toolOptions = { toolCallId: "test", messages: [] };

  // Test Write
  console.log("📝 Testing Write tool...");
  const writeResult = await execute(
    tools.Write,
    {
      file_path: "/tmp/bashkit-test/test.ts",
      content: 'console.log("Hello from bashkit!");',
    },
    toolOptions,
  );
  console.log("Write result:", writeResult);

  // Test Read
  console.log("\n📖 Testing Read tool...");
  const readResult = await execute(
    tools.Read,
    { file_path: "/tmp/bashkit-test/test.ts" },
    toolOptions,
  );
  console.log("Read result:", readResult);

  // Test Bash
  console.log("\n💻 Testing Bash tool...");
  const bashResult = await execute(
    tools.Bash,
    {
      command: "bun run /tmp/bashkit-test/test.ts",
      description: "Run test file",
    },
    toolOptions,
  );
  console.log("Bash result:", bashResult);

  // Test Edit
  console.log("\n✏️ Testing Edit tool...");
  const editResult = await execute(
    tools.Edit,
    {
      file_path: "/tmp/bashkit-test/test.ts",
      old_string: "Hello from bashkit!",
      new_string: "Hello from bashkit! (edited)",
    },
    toolOptions,
  );
  console.log("Edit result:", editResult);

  // Verify edit
  const verifyResult = await execute(
    tools.Read,
    { file_path: "/tmp/bashkit-test/test.ts" },
    toolOptions,
  );
  console.log("Verified content:", verifyResult);

  // Test Glob
  console.log("\n🔍 Testing Glob tool...");
  const globResult = await execute(
    tools.Glob,
    { pattern: "*.ts", path: "/tmp/bashkit-test" },
    toolOptions,
  );
  console.log("Glob result:", globResult);

  // Test Grep
  console.log("\n🔎 Testing Grep tool...");
  const grepResult = await execute(
    tools.Grep,
    { pattern: "bashkit", path: "/tmp/bashkit-test" },
    toolOptions,
  );
  console.log("Grep result:", grepResult);

  console.log("\n✅ All tools tested successfully!");

  await sandbox.destroy();
}

main().catch(console.error);
