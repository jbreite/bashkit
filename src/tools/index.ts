import type { Tool } from "ai";
import type { Sandbox } from "../sandbox/interface";
import type { AgentConfig } from "../types";
import { DEFAULT_CONFIG } from "../types";
import { createBashTool } from "./bash";
import { createReadTool } from "./read";
import { createWriteTool } from "./write";
import { createEditTool } from "./edit";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = Tool<any, any>;

export function createAgentTools(
  sandbox: Sandbox,
  config?: AgentConfig
): Record<string, AnyTool> {
  const mergedConfig: AgentConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    tools: {
      ...DEFAULT_CONFIG.tools,
      ...config?.tools,
    },
  };

  const tools: Record<string, AnyTool> = {};

  const bashTool = createBashTool(sandbox, mergedConfig.tools?.Bash);
  if (bashTool) tools.Bash = bashTool;

  const readTool = createReadTool(sandbox, mergedConfig.tools?.Read);
  if (readTool) tools.Read = readTool;

  const writeTool = createWriteTool(sandbox, mergedConfig.tools?.Write);
  if (writeTool) tools.Write = writeTool;

  const editTool = createEditTool(sandbox, mergedConfig.tools?.Edit);
  if (editTool) tools.Edit = editTool;

  const globTool = createGlobTool(sandbox, mergedConfig.tools?.Glob);
  if (globTool) tools.Glob = globTool;

  const grepTool = createGrepTool(sandbox, mergedConfig.tools?.Grep);
  if (grepTool) tools.Grep = grepTool;

  return tools;
}

export { createBashTool } from "./bash";
export { createReadTool } from "./read";
export { createWriteTool } from "./write";
export { createEditTool } from "./edit";
export { createGlobTool } from "./glob";
export { createGrepTool } from "./grep";

export type { BashOutput, BashError } from "./bash";
export type {
  ReadOutput,
  ReadTextOutput,
  ReadDirectoryOutput,
  ReadError,
} from "./read";
export type { WriteOutput, WriteError } from "./write";
export type { EditOutput, EditError } from "./edit";
export type { GlobOutput, GlobError } from "./glob";
export type {
  GrepOutput,
  GrepContentOutput,
  GrepFilesOutput,
  GrepCountOutput,
  GrepMatch,
  GrepError,
} from "./grep";
