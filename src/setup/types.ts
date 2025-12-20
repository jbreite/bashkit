import type { SkillMetadata } from "../skills";
import type { SkillBundle } from "../skills/fetch";

/**
 * A skill can be either:
 * - A string (just SKILL.md content for inline skills)
 * - A SkillBundle (complete folder with all files, from fetchSkill)
 */
export type SkillContent = string | SkillBundle;

/**
 * Configuration for setting up an agent environment in a sandbox.
 */
export interface AgentEnvironmentConfig {
  /**
   * Workspace directories to create in the sandbox.
   * Keys are logical names, values are paths.
   *
   * @example
   * workspace: {
   *   notes: 'files/notes/',
   *   outputs: 'files/outputs/',
   * }
   */
  workspace?: Record<string, string>;

  /**
   * Skills to seed into the sandbox.
   * Keys are skill names (folder names).
   * Values can be:
   * - A string: just the SKILL.md content (for inline skills)
   * - A SkillBundle: complete folder from fetchSkill() (for remote skills)
   *
   * @example
   * skills: {
   *   'web-research': webResearchSkillContent,  // inline string
   *   'pdf': await fetchSkill('anthropics/skills/pdf'),  // SkillBundle
   * }
   */
  skills?: Record<string, SkillContent>;
}

/**
 * Result from setting up an agent environment.
 */
export interface SetupResult {
  /**
   * Parsed skill metadata for use with skillsToXml().
   */
  skills: SkillMetadata[];
}
