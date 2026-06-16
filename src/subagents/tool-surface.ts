import type { ToolSet } from "ai";
import {
  createCodemodeTool,
  type CodemodeConfig,
  type CodemodeToolProvider,
} from "../tools/codemode";
import { filterSubagentTools } from "./tool-filter";
import type { ResolvedSubagentProfile } from "./types";

export interface SubagentToolSurfaceConfig {
  codemode?: CodemodeConfig;
}

export interface SubagentCodemodeSurface {
  name: string;
  runtimeTools: ToolSet;
  providers: CodemodeToolProvider[];
}

export interface SubagentToolSurface {
  tools: ToolSet;
  directTools: ToolSet;
  codemode: SubagentCodemodeSurface | null;
}

function intersectDefined(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): string[] | undefined {
  if (!left && !right) return undefined;
  if (!left) return [...(right ?? [])];
  if (!right) return [...left];

  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function mergeExclusions(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): string[] | undefined {
  const merged = [...(left ?? []), ...(right ?? [])];
  return merged.length > 0 ? [...new Set(merged)] : undefined;
}

export async function createSubagentToolSurface(options: {
  tools: ToolSet;
  profile: ResolvedSubagentProfile;
  config?: SubagentToolSurfaceConfig;
}): Promise<SubagentToolSurface> {
  const filteredTools = filterSubagentTools(options.tools, {
    allowedTools: options.profile.allowedTools,
    deniedTools: options.profile.deniedTools,
    deniedBehavior: options.profile.deniedBehavior,
    profileName: options.profile.name,
  });
  const directTools = options.profile.codemode.exposeDirectTools
    ? filteredTools
    : {};
  const surfaceTools: ToolSet = { ...directTools };

  if (options.profile.codemode.enabled && options.config?.codemode) {
    const codemodeConfig: CodemodeConfig = {
      ...options.config.codemode,
      includeTools: intersectDefined(
        options.config.codemode.includeTools,
        options.profile.codemode.includeTools,
      ),
      excludeTools: mergeExclusions(
        options.config.codemode.excludeTools,
        options.profile.codemode.excludeTools,
      ),
    };
    const codemode = await createCodemodeTool(filteredTools, codemodeConfig);
    surfaceTools[codemode.name] = codemode.tool;
    return {
      tools: surfaceTools,
      directTools,
      codemode: {
        name: codemode.name,
        runtimeTools: codemode.runtimeTools,
        providers: codemode.providers,
      },
    };
  }

  return {
    tools: surfaceTools,
    directTools,
    codemode: null,
  };
}
