import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox/interface";
import type { SkillMetadata } from "../skills/types";

export interface SkillOutput {
  name: string;
  instructions: string;
  allowed_tools?: string[];
  message: string;
}

export interface SkillError {
  error: string;
}

const skillInputSchema = z.object({
  name: z
    .string()
    .describe("The name of the skill to activate (from available skills list)"),
});

type SkillInput = z.infer<typeof skillInputSchema>;

const SKILL_DESCRIPTION = `Activate a skill to get specialized instructions for a task.

**How skills work:**
1. Skills are pre-loaded at startup (only metadata: name, description, path)
2. Calling this tool loads the full skill instructions from SKILL.md
3. Follow the returned instructions to complete the task
4. Some skills restrict which tools you can use (allowed_tools)

**When to use:**
- A task matches a skill's description
- You need specialized knowledge for a domain (e.g., PDF processing, web research)
- The skill provides step-by-step guidance you should follow

**Available skills are listed in the system prompt.**`;

export interface SkillToolConfig {
  /** Map of skill name to metadata (from discoverSkills or setupAgentEnvironment) */
  skills: Record<string, SkillMetadata>;
  /** Sandbox for reading skill files (optional if skills have embedded content) */
  sandbox?: Sandbox;
  /** Callback when a skill is activated */
  onActivate?: (
    skill: SkillMetadata,
    instructions: string,
  ) => void | Promise<void>;
}

/**
 * Creates a tool for activating and loading skills.
 *
 * @param config - Configuration with available skills and optional sandbox
 */
export function createSkillTool(config: SkillToolConfig) {
  const { skills, sandbox, onActivate } = config;

  return tool({
    description: SKILL_DESCRIPTION,
    inputSchema: zodSchema(skillInputSchema),
    execute: async ({
      name,
    }: SkillInput): Promise<SkillOutput | SkillError> => {
      try {
        const skill = skills[name];
        if (!skill) {
          const available = Object.keys(skills);
          if (available.length === 0) {
            return { error: "No skills are available." };
          }
          return {
            error: `Skill '${name}' not found. Available skills: ${available.join(
              ", ",
            )}`,
          };
        }

        // Load full skill content from SKILL.md
        let instructions: string;

        if (!sandbox) {
          return {
            error: `Cannot load skill '${name}': no sandbox provided to read ${skill.path}`,
          };
        }

        const content = await sandbox.readFile(skill.path);

        // Extract instructions (everything after frontmatter)
        const frontmatterEnd = content.indexOf("\n---", 4);
        if (frontmatterEnd !== -1) {
          instructions = content.slice(frontmatterEnd + 4).trim();
        } else {
          // No frontmatter found, use entire content
          instructions = content;
        }

        if (onActivate) {
          await onActivate(skill, instructions);
        }

        return {
          name: skill.name,
          instructions,
          allowed_tools: skill.allowedTools,
          message: skill.allowedTools
            ? `Skill '${name}' activated. Restricted to tools: ${skill.allowedTools.join(
                ", ",
              )}`
            : `Skill '${name}' activated. Follow the instructions below.`,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
