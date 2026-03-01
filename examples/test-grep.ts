/**
 * Test grep functionality across all sandbox environments
 */
import {
  createAgentTools,
  createLocalSandbox,
  createE2BSandbox,
  createVercelSandbox,
  type Sandbox,
} from "../src";

const toolOptions = { toolCallId: "test", messages: [] };

async function testGrep(name: string, sandbox: Sandbox, testDir: string) {
  console.log(`\n📍 Testing ${name}...`);

  const testFile = `${testDir}/grep-test.txt`;

  // Create test directory and file
  await sandbox.exec(`mkdir -p ${testDir}`);
  await sandbox.writeFile(testFile, "Hello world\nfoo bar\nHello again");

  const { tools } = await createAgentTools(sandbox);

  if (!tools.Grep.execute) {
    console.log(`❌ ${name}: Grep tool not found`);
    return false;
  }

  // Test grep
  const result = await tools.Grep.execute(
    { pattern: "Hello", path: testDir },
    toolOptions,
  );

  if ("error" in result) {
    console.log(`❌ ${name}: ${result.error}`);
    return false;
  }

  if ("files" in result && result.files.length > 0) {
    console.log(`✅ ${name}: Found ${result.count} file(s) matching "Hello"`);
    console.log(`   Files: ${result.files.join(", ")}`);
    return true;
  }

  console.log(`❌ ${name}: No matches found`);
  return false;
}

async function main() {
  console.log("🔍 Testing Grep across sandbox environments\n");

  const results: Record<string, boolean> = {};

  // Test LocalSandbox
  try {
    const local = createLocalSandbox({ cwd: "/tmp" });
    results.LocalSandbox = await testGrep(
      "LocalSandbox",
      local,
      "/tmp/bashkit-grep-test",
    );
  } catch (error) {
    console.log(`❌ LocalSandbox: ${error}`);
    results.LocalSandbox = false;
  }

  // Test E2B Sandbox (requires E2B_API_KEY)
  if (process.env.E2B_API_KEY) {
    let e2bSandbox: Sandbox | null = null;
    try {
      e2bSandbox = await createE2BSandbox({
        apiKey: process.env.E2B_API_KEY,
      });
      results.E2BSandbox = await testGrep(
        "E2BSandbox",
        e2bSandbox,
        "/home/user/grep-test",
      );
    } catch (error) {
      console.log(`❌ E2BSandbox: ${error}`);
      results.E2BSandbox = false;
    } finally {
      if (e2bSandbox) await e2bSandbox.destroy();
    }
  } else {
    console.log("\n⏭️  Skipping E2BSandbox (E2B_API_KEY not set)");
  }

  // Test Vercel Sandbox (requires VERCEL_TOKEN)
  if (process.env.VERCEL_TOKEN) {
    let vercelSandbox: Sandbox | null = null;
    try {
      vercelSandbox = await createVercelSandbox({
        token: process.env.VERCEL_TOKEN,
        teamId: process.env.VERCEL_TEAM_ID,
      });
      results.VercelSandbox = await testGrep(
        "VercelSandbox",
        vercelSandbox,
        "/vercel/sandbox/grep-test",
      );
    } catch (error) {
      console.log(`❌ VercelSandbox: ${error}`);
      results.VercelSandbox = false;
    } finally {
      if (vercelSandbox) await vercelSandbox.destroy();
    }
  } else {
    console.log("\n⏭️  Skipping VercelSandbox (VERCEL_TOKEN not set)");
  }

  // Summary
  console.log(`\n${"=".repeat(40)}`);
  console.log("Summary:");
  for (const [name, passed] of Object.entries(results)) {
    console.log(`  ${passed ? "✅" : "❌"} ${name}`);
  }
}

main().catch(console.error);
