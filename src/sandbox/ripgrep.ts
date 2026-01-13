/**
 * Dynamically imports @vscode/ripgrep to get the bundled binary path.
 * Returns undefined if the package is not installed.
 *
 * Uses dynamic import to avoid bundling issues in environments
 * that don't support Node.js require() (e.g., Cloudflare Workers).
 */
export async function getBundledRgPath(): Promise<string | undefined> {
  try {
    const { rgPath } = await import("@vscode/ripgrep");
    return rgPath;
  } catch {
    return undefined;
  }
}
