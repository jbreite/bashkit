export interface ToolGuidanceConfig {
  /** Tool names that are registered */
  tools: string[];
  /** Per-tool one-line hints. Merged with defaults. */
  hints?: Record<string, string>;
  /** General guidelines to include */
  guidelines?: string[];
}

const DEFAULT_HINTS: Record<string, string> = {
  Bash: "Execute shell commands. Prefer Read/Grep/Glob over bash for file exploration.",
  Read: "Read files or list directories. Use offset/limit for large files.",
  Write: "Create or overwrite files. Read first before overwriting.",
  Edit: "Replace exact strings in files. Prefer over Write for modifications.",
  Glob: "Find files by pattern. Faster than bash find.",
  Grep: "Search file contents with regex. Faster than bash grep.",
  WebSearch: "Search the web. Use for current information.",
  WebFetch: "Fetch and analyze a URL.",
  Task: "Spawn sub-agents for complex parallel work.",
  TodoWrite: "Track multi-step task progress.",
};

/**
 * Generate tool guidance text based on which tools are available.
 * Only includes hints for tools that are actually registered.
 */
export function buildToolGuidance(config: ToolGuidanceConfig): string {
  const hints = { ...DEFAULT_HINTS, ...config.hints };
  const lines = ["## Available Tools"];

  for (const tool of config.tools) {
    const hint = hints[tool];
    if (hint) {
      lines.push(`- **${tool}**: ${hint}`);
    }
  }

  if (config.guidelines?.length) {
    lines.push("", "## Guidelines");
    for (const g of config.guidelines) {
      lines.push(`- ${g}`);
    }
  }

  return lines.join("\n");
}
