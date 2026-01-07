import { rgPath as bundledRgPath } from "@vscode/ripgrep";
import type { Sandbox } from "./interface";

const RIPGREP_VERSION = "14.1.0";
const RIPGREP_URL = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`;

/**
 * Ensures required tools (ripgrep) are available in the sandbox.
 * Call this once during sandbox setup, before using tools like Grep.
 *
 * - For local sandboxes: verifies bundled binary exists
 * - For remote sandboxes: installs ripgrep to /tmp/rg if not present
 *
 * After calling, `sandbox.rgPath` will be set to the correct path.
 *
 * @example
 * ```typescript
 * const sandbox = await createVercelSandbox();
 * await ensureSandboxTools(sandbox);
 *
 * const { tools } = createAgentTools(sandbox);
 * // Grep now works
 * ```
 */
export async function ensureSandboxTools(sandbox: Sandbox): Promise<void> {
  // Check if bundled ripgrep is accessible (local sandbox or bashkit installed in sandbox)
  const bundledCheck = await sandbox.exec(
    `test -x "${bundledRgPath}" && echo found`,
  );
  if (bundledCheck.stdout.includes("found")) {
    sandbox.rgPath = bundledRgPath;
    return;
  }

  // Check if already installed to /tmp
  const tmpCheck = await sandbox.exec("test -x /tmp/rg && echo found");
  if (tmpCheck.stdout.includes("found")) {
    sandbox.rgPath = "/tmp/rg";
    return;
  }

  // Check if system rg exists
  const systemCheck = await sandbox.exec("which rg 2>/dev/null");
  if (systemCheck.exitCode === 0 && systemCheck.stdout.trim()) {
    sandbox.rgPath = systemCheck.stdout.trim();
    return;
  }

  // Install ripgrep to /tmp
  const installResult = await sandbox.exec(`
    curl -sL "${RIPGREP_URL}" |
    tar xzf - -C /tmp --strip-components=1 ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl/rg &&
    chmod +x /tmp/rg
  `);

  if (installResult.exitCode !== 0) {
    throw new Error(`Failed to install ripgrep: ${installResult.stderr}`);
  }

  sandbox.rgPath = "/tmp/rg";
}
