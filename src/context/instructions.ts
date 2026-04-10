import type { Sandbox } from "../sandbox/interface";

export interface InstructionDiscoveryConfig {
  /** Starting directory for upward search. Defaults to sandbox CWD. */
  cwd?: string;
  /** Filenames to search for, in priority order. Default: ["AGENTS.md", "CLAUDE.md"] */
  filenames?: string[];
  /** Markers that indicate project root. Default: [".git"] */
  rootMarkers?: string[];
  /** Max bytes before truncation. Default: 32768 (32KB, matches Codex) */
  maxBytes?: number;
  /** Global instruction file path. Default: none */
  globalPath?: string;
}

export interface DiscoveredInstructions {
  /** Combined instruction text, ready for prompt injection */
  text: string;
  /** Individual files that were found and loaded */
  sources: Array<{
    path: string;
    scope: "global" | "project" | "local";
    bytes: number;
    truncated: boolean;
  }>;
}

/**
 * Discover and merge instruction files (AGENTS.md / CLAUDE.md) by walking
 * from CWD up to project root. Global instructions prepended if provided.
 *
 * Search order per directory: first matching filename wins.
 * Merge order: global → project root → ... → CWD (most specific last).
 */
export async function discoverInstructions(
  sandbox: Sandbox,
  config?: InstructionDiscoveryConfig,
): Promise<DiscoveredInstructions | null> {
  const filenames = config?.filenames ?? ["AGENTS.md", "CLAUDE.md"];
  const rootMarkers = config?.rootMarkers ?? [".git"];
  const maxBytes = config?.maxBytes ?? 32768;
  const cwd =
    config?.cwd ??
    (sandbox as { workingDirectory?: string }).workingDirectory ??
    "/tmp";

  const sources: DiscoveredInstructions["sources"] = [];
  const sections: string[] = [];

  // 1. Walk upward from CWD to find project root and collect instruction files
  const dirsToSearch: string[] = [];
  let dir = cwd;
  let projectRoot: string | null = null;

  while (true) {
    dirsToSearch.push(dir);

    // Check for root markers
    for (const marker of rootMarkers) {
      const markerPath = `${dir}/${marker}`;
      if (await sandbox.fileExists(markerPath)) {
        projectRoot = dir;
      }
    }

    if (projectRoot) break;

    // Move up
    const parent = dir.replace(/\/[^/]+$/, "");
    if (parent === dir) break; // at filesystem root
    dir = parent;
  }

  // 2. Collect instruction files from root down to CWD (most specific last)
  const orderedDirs = dirsToSearch.reverse(); // root first, CWD last

  for (const searchDir of orderedDirs) {
    for (const filename of filenames) {
      const filePath = `${searchDir}/${filename}`;
      try {
        if (await sandbox.fileExists(filePath)) {
          const content = await sandbox.readFile(filePath);
          const scope =
            searchDir === cwd
              ? "local"
              : searchDir === projectRoot
                ? "project"
                : "local";
          sections.push(content);
          sources.push({
            path: filePath,
            scope,
            bytes: content.length,
            truncated: false,
          });
          break; // first matching filename wins per directory
        }
      } catch {
        // Skip files we can't read
      }
    }
  }

  // 3. Prepend global instructions if configured
  if (config?.globalPath) {
    try {
      if (await sandbox.fileExists(config.globalPath)) {
        const content = await sandbox.readFile(config.globalPath);
        sections.unshift(content);
        sources.unshift({
          path: config.globalPath,
          scope: "global",
          bytes: content.length,
          truncated: false,
        });
      }
    } catch {
      // Skip if can't read
    }
  }

  if (sections.length === 0) return null;

  // 4. Concatenate with separator
  let combined = sections.join("\n\n--- project-doc ---\n\n");

  // 5. Truncate if needed
  if (combined.length > maxBytes) {
    combined = combined.slice(0, maxBytes);
    // Mark last source as truncated
    if (sources.length > 0) {
      sources[sources.length - 1].truncated = true;
    }
  }

  return { text: combined, sources };
}
