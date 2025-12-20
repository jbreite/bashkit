import type { Sandbox } from "../sandbox/interface";
import { parseSkillMetadata } from "../skills";
import type { SkillMetadata } from "../skills";
import type { AgentEnvironmentConfig, SetupResult } from "./types";

/**
 * Sets up an agent environment in a sandbox.
 *
 * Creates workspace directories and seeds skills into the sandbox filesystem.
 * Returns parsed skill metadata for use with skillsToXml().
 *
 * @param sandbox - The sandbox to set up
 * @param config - Environment configuration
 * @returns Setup result with skills metadata
 *
 * @example
 * ```typescript
 * const config = {
 *   workspace: {
 *     notes: 'files/notes/',
 *     outputs: 'files/outputs/',
 *   },
 *   skills: {
 *     'web-research': webResearchContent,
 *   },
 * };
 *
 * const { skills } = await setupAgentEnvironment(sandbox, config);
 *
 * const systemPrompt = `You are an assistant.
 * Save notes to: ${config.workspace.notes}
 * ${skillsToXml(skills)}
 * `;
 * ```
 */
export async function setupAgentEnvironment(
  sandbox: Sandbox,
  config: AgentEnvironmentConfig,
): Promise<SetupResult> {
  const skills: SkillMetadata[] = [];

  // Create workspace directories
  if (config.workspace) {
    for (const path of Object.values(config.workspace)) {
      await createDirectory(sandbox, path);
    }
  }

  // Seed skills
  if (config.skills) {
    // Create .skills directory
    await createDirectory(sandbox, ".skills");

    for (const [name, content] of Object.entries(config.skills)) {
      const skillDir = `.skills/${name}`;
      const skillPath = `${skillDir}/SKILL.md`;

      // Create skill directory
      await createDirectory(sandbox, skillDir);

      // Write SKILL.md
      await sandbox.writeFile(skillPath, content);

      // Parse metadata
      try {
        const metadata = parseSkillMetadata(content, skillPath);
        skills.push(metadata);
      } catch {
        // If parsing fails, create minimal metadata
        skills.push({
          name,
          description: `Skill: ${name}`,
          path: skillPath,
        });
      }
    }
  }

  return { skills };
}

/**
 * Creates a directory in the sandbox, including parent directories.
 */
async function createDirectory(sandbox: Sandbox, path: string): Promise<void> {
  // Normalize path - remove trailing slash
  const normalizedPath = path.replace(/\/+$/, "");

  if (!normalizedPath) return;

  // Check if directory exists
  const exists = await sandbox.fileExists(normalizedPath);
  if (exists) {
    const isDir = await sandbox.isDirectory(normalizedPath);
    if (isDir) return;
  }

  // Create directory using mkdir -p via exec
  await sandbox.exec(`mkdir -p "${normalizedPath}"`);
}
