import type { Sandbox } from "../sandbox/interface";

export interface EnvironmentContext {
  cwd: string;
  shell: string;
  platform: string;
  date: string; // YYYY-MM-DD
  timezone?: string;
  gitBranch?: string;
  gitStatus?: string; // changed file count
}

export interface EnvironmentContextConfig {
  /** Include git info. Default: true */
  git?: boolean;
  /** Include timezone. Default: true */
  timezone?: boolean;
  /** Custom fields to inject */
  custom?: Record<string, string>;
}

/**
 * Collect current environment context from the sandbox.
 * Designed to be called per-turn so the model always has fresh state.
 */
export async function collectEnvironment(
  sandbox: Sandbox,
  config?: EnvironmentContextConfig,
): Promise<EnvironmentContext> {
  const cwd =
    (sandbox as { workingDirectory?: string }).workingDirectory ?? "/tmp";

  const [shellResult, gitBranch, gitStatus, tz] = await Promise.all([
    sandbox.exec("echo $SHELL", { timeout: 5000 }).catch(() => null),
    config?.git !== false
      ? sandbox
          .exec("git branch --show-current 2>/dev/null", { timeout: 5000 })
          .catch(() => null)
      : null,
    config?.git !== false
      ? sandbox
          .exec("git status --porcelain 2>/dev/null | wc -l", {
            timeout: 5000,
          })
          .catch(() => null)
      : null,
    config?.timezone !== false
      ? sandbox
          .exec("date +%Z 2>/dev/null", { timeout: 5000 })
          .catch(() => null)
      : null,
  ]);

  return {
    cwd,
    shell: shellResult?.stdout?.trim() ?? "unknown",
    platform: typeof process !== "undefined" ? process.platform : "unknown",
    date: new Date().toISOString().split("T")[0],
    timezone: tz?.stdout?.trim() || undefined,
    gitBranch: gitBranch?.stdout?.trim() || undefined,
    gitStatus: gitStatus?.stdout?.trim() || undefined,
  };
}

/**
 * Format environment context as XML for prompt injection.
 * Matches Codex's <environment_context> format.
 */
export function formatEnvironment(
  env: EnvironmentContext,
  custom?: Record<string, string>,
): string {
  const lines = [
    "<environment_context>",
    `  <cwd>${env.cwd}</cwd>`,
    `  <shell>${env.shell}</shell>`,
    `  <platform>${env.platform}</platform>`,
    `  <date>${env.date}</date>`,
  ];
  if (env.timezone) lines.push(`  <timezone>${env.timezone}</timezone>`);
  if (env.gitBranch) lines.push(`  <git_branch>${env.gitBranch}</git_branch>`);
  if (env.gitStatus)
    lines.push(`  <git_changed_files>${env.gitStatus}</git_changed_files>`);
  if (custom) {
    for (const [key, value] of Object.entries(custom)) {
      lines.push(`  <${key}>${value}</${key}>`);
    }
  }
  lines.push("</environment_context>");
  return lines.join("\n");
}
