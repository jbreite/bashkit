import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseSkillMetadata } from "./loader";
import type { DiscoverSkillsOptions, SkillMetadata } from "./types";

/** Default paths to search for skills */
const DEFAULT_SKILL_PATHS = [".skills", "~/.bashkit/skills"];

/**
 * Discovers skills from configured directories.
 * Parses only frontmatter metadata for progressive disclosure.
 *
 * @param options - Discovery options
 * @returns Array of skill metadata (empty if no skills found)
 */
export async function discoverSkills(
  options?: DiscoverSkillsOptions,
): Promise<SkillMetadata[]> {
  const cwd = options?.cwd ?? process.cwd();
  const searchPaths = options?.paths ?? DEFAULT_SKILL_PATHS;

  const skills: SkillMetadata[] = [];
  const seenNames = new Set<string>();

  // Process paths in order (earlier paths have priority for deduplication)
  for (const searchPath of searchPaths) {
    const resolvedPath = resolvePath(searchPath, cwd);
    const foundSkills = await scanDirectory(resolvedPath);

    for (const skill of foundSkills) {
      // Deduplicate by name - first occurrence wins (project skills override global)
      if (!seenNames.has(skill.name)) {
        seenNames.add(skill.name);
        skills.push(skill);
      }
    }
  }

  return skills;
}

/**
 * Resolves a path, expanding ~ to home directory.
 */
function resolvePath(path: string, cwd: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path.startsWith("/")) {
    return path;
  }
  return resolve(cwd, path);
}

/**
 * Scans a directory for skill folders.
 * Each subfolder with a SKILL.md file is treated as a skill.
 */
async function scanDirectory(dirPath: string): Promise<SkillMetadata[]> {
  const skills: SkillMetadata[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillPath = join(dirPath, entry.name, "SKILL.md");

      try {
        const skillStat = await stat(skillPath);
        if (!skillStat.isFile()) {
          continue;
        }

        const content = await readFile(skillPath, "utf-8");
        const metadata = parseSkillMetadata(content, skillPath);

        // Validate that name matches folder name per spec
        if (metadata.name !== entry.name) {
          console.warn(
            `Skill name "${metadata.name}" does not match folder name "${entry.name}" in ${skillPath}`,
          );
        }

        skills.push(metadata);
      } catch {}
    }
  } catch {
    // Directory doesn't exist or can't be read - return empty
    return [];
  }

  return skills;
}
