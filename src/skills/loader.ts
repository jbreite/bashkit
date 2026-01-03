import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { SkillBundle } from "./fetch";
import type { SkillMetadata } from "./types";

/**
 * Parses YAML frontmatter from a SKILL.md file content.
 * Only extracts metadata - ignores the markdown body for progressive disclosure.
 *
 * @param content - Raw content of SKILL.md file
 * @param skillPath - Absolute path to the SKILL.md file
 * @returns Parsed skill metadata
 * @throws Error if required fields (name, description) are missing
 */
export function parseSkillMetadata(
  content: string,
  skillPath: string,
): SkillMetadata {
  const frontmatter = extractFrontmatter(content);

  if (!frontmatter) {
    throw new Error(`No YAML frontmatter found in ${skillPath}`);
  }

  const parsed = parseYaml(frontmatter);

  // Validate required fields
  if (!parsed.name || typeof parsed.name !== "string") {
    throw new Error(`Missing or invalid 'name' field in ${skillPath}`);
  }
  if (!parsed.description || typeof parsed.description !== "string") {
    throw new Error(`Missing or invalid 'description' field in ${skillPath}`);
  }

  // Validate name format per spec: 1-64 chars, lowercase + hyphens, no start/end hyphen
  const nameRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  if (
    parsed.name.length > 64 ||
    (parsed.name.length > 1 && !nameRegex.test(parsed.name)) ||
    parsed.name.includes("--")
  ) {
    throw new Error(
      `Invalid 'name' format in ${skillPath}: must be 1-64 lowercase chars/hyphens, no start/end/consecutive hyphens`,
    );
  }

  // Parse allowed-tools (space-delimited string to array)
  let allowedTools: string[] | undefined;
  if (parsed["allowed-tools"]) {
    const toolsStr = String(parsed["allowed-tools"]);
    allowedTools = toolsStr.split(/\s+/).filter(Boolean);
  }

  // Parse metadata (ensure string values)
  let metadata: Record<string, string> | undefined;
  if (parsed.metadata && typeof parsed.metadata === "object") {
    metadata = {};
    for (const [key, value] of Object.entries(parsed.metadata)) {
      metadata[key] = String(value);
    }
  }

  return {
    name: parsed.name,
    description: parsed.description,
    path: skillPath,
    license: parsed.license ? String(parsed.license) : undefined,
    compatibility: parsed.compatibility
      ? String(parsed.compatibility)
      : undefined,
    metadata,
    allowedTools,
  };
}

/**
 * Extracts YAML frontmatter from markdown content.
 * Frontmatter is delimited by --- at the start of the file.
 */
function extractFrontmatter(content: string): string | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return null;
  }

  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return null;
  }

  return trimmed.slice(3, endIndex).trim();
}

/**
 * Simple YAML parser for frontmatter.
 * Handles basic key-value pairs and nested objects (for metadata field).
 * Does not handle arrays, complex nesting, or advanced YAML features.
 */
function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");

  let currentKey: string | null = null;
  let currentObject: Record<string, string> | null = null;

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }

    // Check for nested object value (indented)
    const nestedMatch = line.match(/^(\s{2,})(\w+):\s*(.*)$/);
    if (nestedMatch && currentKey && currentObject) {
      const [, , key, value] = nestedMatch;
      currentObject[key] = value.trim().replace(/^["']|["']$/g, "");
      continue;
    }

    // Check for top-level key-value
    const topMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (topMatch) {
      // Save previous nested object if any
      if (currentKey && currentObject) {
        result[currentKey] = currentObject;
        currentObject = null;
      }

      const [, key, value] = topMatch;
      const trimmedValue = value.trim();

      if (trimmedValue === "" || trimmedValue === "|" || trimmedValue === ">") {
        // This might be a nested object or multiline - start collecting
        currentKey = key;
        currentObject = {};
      } else {
        // Simple value
        result[key] = trimmedValue.replace(/^["']|["']$/g, "");
        currentKey = null;
      }
    }
  }

  // Save final nested object
  if (currentKey && currentObject && Object.keys(currentObject).length > 0) {
    result[currentKey] = currentObject;
  }

  return result;
}

/**
 * Loads all files from a local skill directory as a SkillBundle.
 * Recursively reads all files, preserving directory structure.
 *
 * @param skillDir - Absolute path to skill directory (containing SKILL.md)
 * @returns SkillBundle with all files
 *
 * @example
 * ```typescript
 * const bundle = await loadSkillBundle('/path/to/.skills/pdf-processing');
 * // bundle.files = {
 * //   'SKILL.md': '---\nname: pdf-processing\n...',
 * //   'templates/report.md': '# Report Template...',
 * //   'scripts/extract.sh': '#!/bin/bash...',
 * // }
 * ```
 */
export async function loadSkillBundle(skillDir: string): Promise<SkillBundle> {
  const files: Record<string, string> = {};
  const name = basename(skillDir);

  async function readDirRecursive(dir: string, prefix = "") {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await readDirRecursive(fullPath, relativePath);
      } else {
        files[relativePath] = await readFile(fullPath, "utf-8");
      }
    }
  }

  await readDirRecursive(skillDir);
  return { name, files };
}

/**
 * Loads multiple discovered skills as bundles.
 * Takes the output of discoverSkills() and loads all files for each skill.
 *
 * @param skills - Array of skill metadata from discoverSkills()
 * @returns Record mapping skill names to their bundles
 *
 * @example
 * ```typescript
 * const discovered = await discoverSkills();
 * const bundles = await loadSkillBundles(discovered);
 *
 * // Use with setupAgentEnvironment
 * await setupAgentEnvironment(sandbox, { skills: bundles });
 * ```
 */
export async function loadSkillBundles(
  skills: SkillMetadata[],
): Promise<Record<string, SkillBundle>> {
  const bundles: Record<string, SkillBundle> = {};

  for (const skill of skills) {
    const skillDir = dirname(skill.path);
    bundles[skill.name] = await loadSkillBundle(skillDir);
  }

  return bundles;
}
