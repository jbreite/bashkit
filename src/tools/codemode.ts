import type { Tool, ToolSet } from "ai";

// Intentionally lowercase to match Cloudflare Codemode's public examples.
const DEFAULT_CODEMODE_TOOL_NAME = "codemode";
const DEFAULT_CODEMODE_TOOL_NAMESPACE = "bashkit";
const DEFAULT_EXCLUDED_TOOL_NAMES = new Set([
  "AskUser",
  "EnterPlanMode",
  "ExitPlanMode",
]);

export type CodemodeToolExclusionReason =
  | "excluded-by-default"
  | "excluded-by-config"
  | "not-included-by-config"
  | "no-execute"
  | "needs-approval";

export interface CodemodeToolProvider {
  /** Namespace exposed inside generated code. Defaults to BashKit's "bashkit". */
  name?: string;
  /** Tools exposed as namespace.toolName() inside generated code. */
  tools: ToolSet;
  /** Optional prebuilt type declarations for this provider. */
  types?: string;
  /** Only expose these provider tool names, after safety exclusions. */
  includeTools?: string[];
  /** Exclude these provider tool names. */
  excludeTools?: string[];
}

export interface CodemodeExecuteResult {
  /** Generated codemode JavaScript can return any value; BashKit does not inspect it. */
  result: unknown;
  error?: string;
  logs?: string[];
}

export interface CodemodeResolvedProvider {
  name: string;
  fns: Record<string, (...args: unknown[]) => Promise<unknown>>;
  prelude?: string;
}

export interface CodemodeConnectorBinding {
  name: string;
  binding: {
    callTool(method: string, args: unknown): Promise<unknown>;
  };
}

export interface CodemodeExecuteOptions {
  connectors?: CodemodeConnectorBinding[];
}

export interface CodemodeExecutor {
  execute(
    code: string,
    providersOrFns:
      | CodemodeResolvedProvider[]
      | Record<string, (...args: unknown[]) => Promise<unknown>>,
    options?: CodemodeExecuteOptions,
  ): Promise<CodemodeExecuteResult>;
}

export type CreateCodeTool = (options: {
  tools: ToolSet | CodemodeToolProvider[];
  executor: CodemodeExecutor;
  description?: string;
}) => Tool | Promise<Tool>;

export interface CodemodeConfig {
  /**
   * Executor passed through to @cloudflare/codemode's createCodeTool().
   * Cloudflare Codemode currently targets AI SDK v6.
   */
  executor: CodemodeExecutor;
  /** Tool name added to the returned ToolSet. Defaults to "codemode" to match Cloudflare examples. */
  toolName?: string;
  /** Namespace for BashKit and codemode-only tools inside generated code. Defaults to "bashkit". */
  namespace?: string;
  /** Extra tools exposed only inside codemode. */
  tools?: ToolSet;
  /** Additional named tool groups exposed inside codemode. */
  providers?: CodemodeToolProvider[];
  /** Custom Cloudflare Codemode tool description. Use {{types}} for generated type declarations. */
  description?: string;
  /** Only expose these tool names to codemode, after safety exclusions. */
  includeTools?: string[];
  /** Exclude these tool names from codemode. */
  excludeTools?: string[];
  /** Test hook / advanced override. Defaults to @cloudflare/codemode/ai createCodeTool. */
  createCodeTool?: CreateCodeTool;
  /** Observability hook for tools filtered out of the Codemode runtime tool set. */
  onToolExcluded?: (
    toolName: string,
    reason: CodemodeToolExclusionReason,
  ) => void;
}

function hasClientIntervention(tool: Tool): boolean {
  return Boolean(tool.needsApproval);
}

export function selectCodemodeTools(
  tools: ToolSet,
  config: Pick<
    CodemodeConfig,
    "includeTools" | "excludeTools" | "onToolExcluded"
  > = {},
): ToolSet {
  const include = config.includeTools ? new Set(config.includeTools) : null;
  const exclude = new Set(config.excludeTools ?? []);
  const selected: ToolSet = {};

  for (const [toolName, tool] of Object.entries(tools)) {
    let exclusion: CodemodeToolExclusionReason | null = null;

    if (DEFAULT_EXCLUDED_TOOL_NAMES.has(toolName)) {
      exclusion = "excluded-by-default";
    } else if (exclude.has(toolName)) {
      exclusion = "excluded-by-config";
    } else if (include && !include.has(toolName)) {
      exclusion = "not-included-by-config";
    } else if (!tool.execute) {
      exclusion = "no-execute";
    } else if (hasClientIntervention(tool)) {
      exclusion = "needs-approval";
    }

    if (exclusion) {
      config.onToolExcluded?.(toolName, exclusion);
      continue;
    }

    selected[toolName] = tool;
  }

  return selected;
}

function selectProviderTools(
  provider: CodemodeToolProvider,
  config: Pick<CodemodeConfig, "excludeTools" | "onToolExcluded">,
): CodemodeToolProvider | null {
  const tools = selectCodemodeTools(provider.tools, {
    excludeTools: provider.excludeTools ?? config.excludeTools,
    includeTools: provider.includeTools,
    onToolExcluded: config.onToolExcluded,
  });
  if (Object.keys(tools).length === 0) return null;

  return {
    ...provider,
    tools,
  };
}

async function loadCreateCodeTool(): Promise<CreateCodeTool> {
  const dynamicImport = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<unknown>;
  let mod: { createCodeTool?: unknown };

  try {
    mod = (await dynamicImport("@cloudflare/codemode/ai")) as {
      createCodeTool?: unknown;
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[bashkit] codemode requires the optional peer dependency @cloudflare/codemode. ` +
        `Install it with "npm install @cloudflare/codemode". Original error: ${message}`,
    );
  }

  if (typeof mod.createCodeTool !== "function") {
    throw new Error(
      "[bashkit] @cloudflare/codemode/ai does not export createCodeTool.",
    );
  }

  return mod.createCodeTool as CreateCodeTool;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function wrapCodemodeTool(tool: Tool): Tool {
  if (!tool.execute) return tool;

  const execute = tool.execute;

  return {
    ...tool,
    execute: async (input, options) => {
      try {
        return await execute(input, options);
      } catch (error) {
        return {
          error: `[bashkit] Codemode execution failed: ${getErrorMessage(error)}`,
        };
      }
    },
  };
}

export async function createCodemodeTool(
  tools: ToolSet,
  config: CodemodeConfig,
): Promise<{
  name: string;
  tool: Tool;
  runtimeTools: ToolSet;
  providers: CodemodeToolProvider[];
}> {
  const defaultProviderTools = {
    ...tools,
    ...(config.tools ?? {}),
  };
  const runtimeTools = selectCodemodeTools(defaultProviderTools, config);
  const providers = [
    ...(Object.keys(runtimeTools).length > 0
      ? [
          {
            name: config.namespace ?? DEFAULT_CODEMODE_TOOL_NAMESPACE,
            tools: runtimeTools,
          },
        ]
      : []),
    ...(config.providers ?? [])
      .map((provider) => selectProviderTools(provider, config))
      .filter(
        (provider): provider is CodemodeToolProvider => provider !== null,
      ),
  ];
  const createCodeTool = config.createCodeTool ?? (await loadCreateCodeTool());
  const createOptions: {
    tools: ToolSet | CodemodeToolProvider[];
    executor: CodemodeExecutor;
    description?: string;
  } = {
    tools: providers,
    executor: config.executor,
  };

  if (config.description !== undefined) {
    createOptions.description = config.description;
  }

  const tool = await createCodeTool({
    ...createOptions,
  });

  return {
    name: config.toolName ?? DEFAULT_CODEMODE_TOOL_NAME,
    tool: wrapCodemodeTool(tool),
    runtimeTools,
    providers,
  };
}
