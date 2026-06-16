/**
 * Codemode + subagent wiring example.
 *
 * This file avoids importing @cloudflare/codemode directly so it can typecheck
 * in repos that keep Codemode as an optional peer. Pass a real executor from
 * your host app, for example a DynamicWorkerExecutor.
 */

import type { LanguageModel } from "ai";
import type { CodemodeExecutor, Sandbox } from "../src";
import {
  createAgentTools,
  loadSubagentProfilesFromJson,
  type SubagentConfig,
} from "../src";

export async function createCodemodeSubagentTools(options: {
  sandbox: Sandbox;
  executor: CodemodeExecutor;
  defaultModel: LanguageModel;
  researcherModel: LanguageModel;
}) {
  const loaded = loadSubagentProfilesFromJson(
    JSON.stringify({
      defaultProfile: "researcher",
      defaults: {
        model: "default",
        context: { recent_turns: 3 },
        cost: {
          maxActiveAgents: 3,
          maxDepth: 1,
        },
      },
      profiles: [
        {
          name: "researcher",
          description: "Read-only repository research",
          model: "researcher",
          system: "Investigate the task. Cite files. Do not edit.",
          allowedTools: ["Read", "Glob", "Grep"],
          deniedTools: ["Write", "Edit", "Bash"],
          codemode: {
            enabled: true,
            exposeDirectTools: false,
            includeTools: ["Read", "Glob", "Grep"],
          },
        },
        {
          name: "implementer",
          description: "Scoped implementation agent",
          system: "Make small, well-tested code changes.",
          allowedTools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
          deniedTools: ["SpawnAgent", "FollowupTask"],
          codemode: {
            enabled: true,
            exposeDirectTools: false,
            includeTools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
          },
        },
      ],
    }),
    {
      models: {
        default: options.defaultModel,
        researcher: options.researcherModel,
      },
    },
  );

  if ("error" in loaded) throw new Error(loaded.error);

  const subagents: SubagentConfig = {
    model: options.defaultModel,
    profiles: loaded.profiles,
    profileDefaults: loaded.defaults,
    defaultProfile: loaded.defaultProfile,
  };

  return createAgentTools(options.sandbox, {
    codemode: {
      executor: options.executor,
      includeTools: ["Read", "Glob", "Grep", "Bash"],
    },
    subagents,
  });
}
