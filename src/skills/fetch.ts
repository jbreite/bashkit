/**
 * Fetches skills from GitHub repositories.
 *
 * Reference format: `owner/repo/skillName`
 * Example: `anthropics/skills/pdf` fetches the entire skill folder from
 * https://github.com/anthropics/skills/tree/main/skills/pdf
 */

/**
 * A complete skill bundle with all files from the skill folder.
 */
export interface SkillBundle {
  /** The skill name (folder name) */
  name: string;
  /** All files in the skill folder. Keys are relative paths, values are file contents. */
  files: Record<string, string>;
}

/**
 * GitHub API response for directory contents.
 */
interface GitHubContentItem {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
}

/**
 * Parses a GitHub skill reference into its components.
 * Format: owner/repo/skillName
 */
function parseGitHubRef(ref: string): {
  owner: string;
  repo: string;
  skillName: string;
} {
  const parts = ref.split("/");

  if (parts.length < 3) {
    throw new Error(
      `Invalid skill reference "${ref}". Expected format: owner/repo/skillName (e.g., anthropics/skills/pdf)`,
    );
  }

  const owner = parts[0];
  const repo = parts[1];
  const skillName = parts[parts.length - 1];

  return { owner, repo, skillName };
}

/**
 * Recursively fetches all files in a GitHub directory.
 * @param basePath - The base skill folder path (e.g., "skills/pdf") used to compute relative paths
 */
async function fetchDirectoryContents(
  owner: string,
  repo: string,
  path: string,
  basePath: string,
  branch: string = "main",
): Promise<Record<string, string>> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "bashkit",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch directory contents from "${path}": ${response.status} ${response.statusText}`,
    );
  }

  const items: GitHubContentItem[] = await response.json();
  const files: Record<string, string> = {};

  await Promise.all(
    items.map(async (item) => {
      if (item.type === "file" && item.download_url) {
        // Fetch file content
        const fileResponse = await fetch(item.download_url);
        if (fileResponse.ok) {
          // Get relative path within the skill folder
          // e.g., "skills/pdf/scripts/extract.py" -> "scripts/extract.py"
          const relativePath = item.path.slice(basePath.length + 1);
          files[relativePath] = await fileResponse.text();
        }
      } else if (item.type === "dir") {
        // Recursively fetch subdirectory
        const subFiles = await fetchDirectoryContents(
          owner,
          repo,
          item.path,
          basePath,
          branch,
        );
        // Merge subdirectory files
        for (const [subPath, content] of Object.entries(subFiles)) {
          files[subPath] = content;
        }
      }
    }),
  );

  return files;
}

/**
 * Fetches a complete skill folder from GitHub.
 *
 * @param ref - GitHub reference in format `owner/repo/skillName`
 *              Example: `anthropics/skills/pdf`
 * @returns A SkillBundle containing all files in the skill folder
 * @throws Error if the skill cannot be fetched
 *
 * @example
 * ```typescript
 * const pdfSkill = await fetchSkill('anthropics/skills/pdf');
 * // Returns:
 * // {
 * //   name: 'pdf',
 * //   files: {
 * //     'SKILL.md': '---\nname: pdf\n...',
 * //     'scripts/extract.py': '...',
 * //     'reference.md': '...',
 * //   }
 * // }
 * ```
 */
export async function fetchSkill(ref: string): Promise<SkillBundle> {
  const { owner, repo, skillName } = parseGitHubRef(ref);

  // Path to the skill folder (anthropics/skills stores skills in skills/ subdirectory)
  const skillPath = `skills/${skillName}`;

  const files = await fetchDirectoryContents(owner, repo, skillPath, skillPath);

  if (!files["SKILL.md"]) {
    throw new Error(
      `Skill "${ref}" does not contain a SKILL.md file. Found files: ${Object.keys(files).join(", ")}`,
    );
  }

  return {
    name: skillName,
    files,
  };
}

/**
 * Fetches multiple skill folders from GitHub in parallel.
 *
 * @param refs - Array of GitHub references in format `owner/repo/skillName`
 * @returns Object mapping skill names to their SkillBundle
 * @throws Error if any skill fails to fetch
 *
 * @example
 * ```typescript
 * const skills = await fetchSkills([
 *   'anthropics/skills/pdf',
 *   'anthropics/skills/web-research',
 * ]);
 * // Returns: { 'pdf': SkillBundle, 'web-research': SkillBundle }
 * ```
 */
export async function fetchSkills(
  refs: string[],
): Promise<Record<string, SkillBundle>> {
  const results = await Promise.all(
    refs.map(async (ref) => {
      const bundle = await fetchSkill(ref);
      return { name: bundle.name, bundle };
    }),
  );

  return Object.fromEntries(results.map(({ name, bundle }) => [name, bundle]));
}
