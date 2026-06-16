/**
 * Controller-backed subagent example without a model provider.
 *
 * Run with: bun examples/subagents.ts
 */

import {
  createAgentTools,
  createLocalSandbox,
  createStaticSubagentRunner,
  loadSubagentProfilesFromJson,
} from "../src";

async function main() {
  const sandbox = createLocalSandbox({ cwd: "/tmp/bashkit-subagents" });

  const loaded = loadSubagentProfilesFromJson(
    JSON.stringify({
      defaultProfile: "researcher",
      profiles: [
        {
          name: "researcher",
          description: "Read-only code researcher",
          system: "Investigate the task and cite relevant files.",
          allowedTools: ["Read", "Glob", "Grep"],
          deniedTools: ["Write", "Edit", "Bash"],
          context: { recent_turns: 2 },
          cost: { maxDepth: 1 },
        },
      ],
    }),
  );

  if ("error" in loaded) throw new Error(loaded.error);

  const { subagentController, getSubagentControlPanelState } =
    await createAgentTools(sandbox, {
      subagents: {
        profiles: loaded.profiles,
        defaultProfile: loaded.defaultProfile,
        runner: createStaticSubagentRunner({
          status: "completed",
          result: "Found the relevant files and summarized the implementation.",
          usage: { stepsCompleted: 1 },
        }),
      },
    });

  if (!subagentController) throw new Error("expected subagent controller");

  const handle = await subagentController.spawn({
    task: "Find where BashKit creates subagent control tools.",
    task_name: "research/control-tools",
  });
  if ("error" in handle) throw new Error(handle.error);

  const result = await subagentController.wait({
    agent: handle.agent_id,
    timeoutMs: 1_000,
  });
  if ("error" in result) throw new Error(result.error);

  console.log("Subagent result:");
  console.log(JSON.stringify(result, null, 2));

  console.log("\nControl panel snapshot:");
  console.log(JSON.stringify(await getSubagentControlPanelState?.(), null, 2));

  await sandbox.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
