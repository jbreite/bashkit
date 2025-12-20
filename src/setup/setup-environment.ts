import type { Sandbox } from "../sandbox/interface";
import { parseSkillMetadata } from "../skills";
import type { SkillMetadata } from "../skills";
import type { SkillBundle } from "../skills/fetch";
import type {
  AgentEnvironmentConfig,
  SetupResult,
  SkillContent,
} from "./types";

/**
 * Checks if a skill content is a SkillBundle (has files) vs a plain string.
 */
function isSkillBundle(content: SkillContent): content is SkillBundle {
  return typeof content === "object" && "files" in content;
}

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
 * const pdfSkill = await fetchSkill('anthropics/skills/pdf');
 *
 * const config = {
 *   workspace: {
 *     notes: 'files/notes/',
 *     outputs: 'files/outputs/',
 *   },
 *   skills: {
 *     'pdf': pdfSkill,  // SkillBundle with all files
 *     'my-custom': mySkillContent,  // inline string
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

      if (isSkillBundle(content)) {
        // SkillBundle: write all files from the bundle
        await seedSkillBundle(sandbox, skillDir, content);

        // Parse metadata from SKILL.md
        const skillMdContent = content.files["SKILL.md"];
        if (skillMdContent) {
          try {
            const metadata = parseSkillMetadata(
              skillMdContent,
              `${skillDir}/SKILL.md`,
            );
            skills.push(metadata);
          } catch {
            skills.push({
              name,
              description: `Skill: ${name}`,
              path: `${skillDir}/SKILL.md`,
            });
          }
        }
      } else {
        // String: just write SKILL.md
        const skillPath = `${skillDir}/SKILL.md`;
        await createDirectory(sandbox, skillDir);
        await sandbox.writeFile(skillPath, content);

        // Parse metadata
        try {
          const metadata = parseSkillMetadata(content, skillPath);
          skills.push(metadata);
        } catch {
          skills.push({
            name,
            description: `Skill: ${name}`,
            path: skillPath,
          });
        }
      }
    }
  }

  return { skills };
}

/**
 * Seeds a complete SkillBundle into the sandbox.
 */
async function seedSkillBundle(
  sandbox: Sandbox,
  skillDir: string,
  bundle: SkillBundle,
): Promise<void> {
  // Create the skill directory
  await createDirectory(sandbox, skillDir);

  // Write all files from the bundle
  for (const [relativePath, content] of Object.entries(bundle.files)) {
    const fullPath = `${skillDir}/${relativePath}`;

    // Create parent directories if needed
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    if (parentDir && parentDir !== skillDir) {
      await createDirectory(sandbox, parentDir);
    }

    // Write the file
    await sandbox.writeFile(fullPath, content);
  }
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
