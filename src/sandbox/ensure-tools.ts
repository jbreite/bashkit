import type { Sandbox } from "./interface";
import { getBundledRgPath } from "./ripgrep";

const RIPGREP_VERSION = "14.1.0";

// Map uname -m output to ripgrep release archive names
const ARCH_MAP: Record<string, string> = {
  x86_64: "x86_64-unknown-linux-musl",
  aarch64: "aarch64-unknown-linux-gnu",
  arm64: "aarch64-unknown-linux-gnu", // macOS reports arm64, Linux reports aarch64
};

/**
 * Ensures required tools (ripgrep) are available in the sandbox.
 * Call this once during sandbox setup, before using tools like Grep.
 *
 * - For local sandboxes: verifies bundled binary exists
 * - For remote sandboxes: installs ripgrep to /tmp/rg if not present
 *
 * Supports x86_64 and ARM64 architectures.
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
  const bundledRgPath = await getBundledRgPath();
  if (bundledRgPath) {
    const bundledCheck = await sandbox.exec(
      `test -x "${bundledRgPath}" && echo found`,
    );
    if (bundledCheck.stdout.includes("found")) {
      sandbox.rgPath = bundledRgPath;
      return;
    }
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

  // Detect architecture for correct binary
  const archResult = await sandbox.exec("uname -m");
  const arch = archResult.stdout.trim();
  const ripgrepArch = ARCH_MAP[arch];

  if (!ripgrepArch) {
    throw new Error(
      `Unsupported architecture: ${arch}. Supported: ${Object.keys(ARCH_MAP).join(", ")}`,
    );
  }

  const ripgrepUrl = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-${ripgrepArch}.tar.gz`;
  const tarPath = `ripgrep-${RIPGREP_VERSION}-${ripgrepArch}/rg`;

  // Install ripgrep to /tmp
  const installResult = await sandbox.exec(`
    curl -sL "${ripgrepUrl}" |
    tar xzf - -C /tmp --strip-components=1 ${tarPath} &&
    chmod +x /tmp/rg
  `);

  if (installResult.exitCode !== 0) {
    throw new Error(`Failed to install ripgrep: ${installResult.stderr}`);
  }

  sandbox.rgPath = "/tmp/rg";
}
