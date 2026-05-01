import type { Tool, ToolSet } from "ai";

// Re-export all context module types and functions
export type { ExecutionPolicyConfig } from "./execution-policy";
export { createExecutionPolicy } from "./execution-policy";

export type {
  OutputPolicyConfig,
  StashOutputConfig,
} from "./output-policy";
export { createOutputPolicy } from "./output-policy";

export type {
  InstructionDiscoveryConfig,
  DiscoveredInstructions,
} from "./instructions";
export { discoverInstructions } from "./instructions";

export type {
  EnvironmentContext,
  EnvironmentContextConfig,
} from "./environment";
export { collectEnvironment, formatEnvironment } from "./environment";

export type { ToolGuidanceConfig } from "./tool-guidance";
export { buildToolGuidance } from "./tool-guidance";

export type {
  SystemContextConfig,
  SystemContext,
} from "./build-context";
export { buildSystemContext } from "./build-context";

export type { PrepareStepConfig } from "./prepare-step";
export { createPrepareStep } from "./prepare-step";

/**
 * Context layer that intercepts tool execution.
 * Params/result typed as Record<string, unknown> since layers
 * operate across all tools (not tool-specific).
 */
export interface ContextLayer {
  /**
   * Called before tool.execute(). Return an error object to block execution.
   * Return undefined to allow execution to proceed.
   */
  beforeExecute?: (
    toolName: string,
    params: Record<string, unknown>,
  ) => Promise<{ error: string } | undefined> | { error: string } | undefined;

  /**
   * Called after tool.execute() with the raw result. Return the result
   * as-is or return a transformed version (e.g., truncated with hints).
   */
  afterExecute?: (
    toolName: string,
    params: Record<string, unknown>,
    result: Record<string, unknown>,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

/**
 * Wrap a single tool with context layers.
 * Preserves the Tool<PARAMETERS, RESULT> generic for type inference.
 *
 * Layers compose: first rejection wins for beforeExecute,
 * transforms chain (pipe) for afterExecute.
 */
export function withContext<T extends Tool>(
  tool: T,
  toolName: string,
  layers: ContextLayer[],
): T {
  const originalExecute = tool.execute;
  if (!originalExecute) return tool; // no-execute tools pass through

  return {
    ...tool,
    execute: async (
      params: Parameters<NonNullable<T["execute"]>>[0],
      execOptions: Parameters<NonNullable<T["execute"]>>[1],
    ) => {
      // Run all beforeExecute gates (first rejection wins)
      const paramsRecord = params as Record<string, unknown>;
      for (const layer of layers) {
        if (layer.beforeExecute) {
          const rejection = await layer.beforeExecute(toolName, paramsRecord);
          if (rejection) return rejection;
        }
      }

      // Execute the tool
      const result = await originalExecute(params, execOptions);

      // Run all afterExecute transforms (piped)
      let transformed = result as Record<string, unknown>;
      for (const layer of layers) {
        if (layer.afterExecute) {
          transformed = await layer.afterExecute(
            toolName,
            paramsRecord,
            transformed,
          );
        }
      }

      return transformed;
    },
  } as T;
}

/**
 * Apply context layers to an entire ToolSet.
 * Returns a new ToolSet with the same keys and types.
 */
export function applyContextLayers<T extends ToolSet>(
  tools: T,
  layers: ContextLayer[],
): T {
  if (layers.length === 0) return tools;

  const wrapped = { ...tools };
  for (const [name, tool] of Object.entries(wrapped)) {
    (wrapped as Record<string, Tool>)[name] = withContext(tool, name, layers);
  }
  return wrapped;
}
