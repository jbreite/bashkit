/**
 * Dynamically imports @vscode/ripgrep to get the bundled binary path.
 * Returns undefined if the package is not installed.
 */
export async function getBundledRgPath(): Promise<string | undefined> {
  try {
    const { rgPath } = await import("@vscode/ripgrep");
    return rgPath;
  } catch {
    return undefined;
  }
}

/**
 * Synchronously gets the bundled ripgrep path using require.
 * For use in synchronous contexts (e.g., LocalSandbox).
 * Returns undefined if the package is not installed.
 */
export function getBundledRgPathSync(): string | undefined {
  try {
    const { rgPath } = require("@vscode/ripgrep");
    return rgPath;
  } catch {
    return undefined;
  }
}
