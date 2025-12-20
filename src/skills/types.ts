/**
 * Lightweight skill metadata loaded at startup.
 * Does NOT include instructions - agent reads full SKILL.md via Read tool when activating.
 */
export interface SkillMetadata {
  // Required (per Agent Skills spec)
  /** Skill identifier: 1-64 chars, lowercase + hyphens, matches folder name */
  name: string;
  /** When to use this skill: 1-1024 chars */
  description: string;

  /** Absolute path to SKILL.md file (agent uses Read tool to get full content) */
  path: string;

  // Optional (per Agent Skills spec)
  /** License name or reference to bundled license file */
  license?: string;
  /** Environment requirements (intended product, system packages, network access, etc.) */
  compatibility?: string;
  /** Arbitrary key-value mapping for additional metadata */
  metadata?: Record<string, string>;
  /** Space-delimited list of pre-approved tools (experimental) */
  allowedTools?: string[];
}

/**
 * Options for discovering skills from the filesystem.
 */
export interface DiscoverSkillsOptions {
  /** Override default discovery paths. Default: [".skills/", "~/.bashkit/skills/"] */
  paths?: string[];
  /** Working directory for resolving relative paths. Default: process.cwd() */
  cwd?: string;
}
