import type { SkillMetadata } from "../skills";

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
   * Keys are skill names (folder names), values are SKILL.md content.
   *
   * @example
   * skills: {
   *   'web-research': webResearchSkillContent,
   *   'code-review': codeReviewSkillContent,
   * }
   */
  skills?: Record<string, string>;
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
