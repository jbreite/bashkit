/**
 * bashkit/cloudflare - Cloudflare Workers compatible exports
 *
 * This module exports only the parts of bashkit that work in Cloudflare Workers.
 * It excludes local sandbox (uses Bun/Node APIs) and bundled ripgrep.
 *
 * @example
 * ```typescript
 * import { createE2BSandbox, createBashTool } from 'bashkit/cloudflare';
 * ```
 */

// E2B Sandbox (cloud-based, Workers compatible)
export { createE2BSandbox, type E2BSandboxConfig } from "../sandbox/e2b";

// Sandbox interface
export type { ExecOptions, ExecResult, Sandbox } from "../sandbox/interface";

// Tools (all Workers compatible)
export { createBashTool } from "../tools/bash";
export { createReadTool } from "../tools/read";
export { createWriteTool } from "../tools/write";
export { createEditTool } from "../tools/edit";
export { createGlobTool } from "../tools/glob";
export { createGrepTool } from "../tools/grep";

// Tool types
export type {
	BashOutput,
	BashError,
	ReadOutput,
	ReadError,
	WriteOutput,
	WriteError,
	EditOutput,
	EditError,
	GlobOutput,
	GlobError,
	GrepOutput,
	GrepError,
} from "../tools";
