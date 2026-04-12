import type { Sandbox } from "../sandbox/interface";
import {
  discoverInstructions,
  type InstructionDiscoveryConfig,
  type DiscoveredInstructions,
} from "./instructions";
import {
  collectEnvironment,
  formatEnvironment,
  type EnvironmentContext,
  type EnvironmentContextConfig,
} from "./environment";
import { buildToolGuidance, type ToolGuidanceConfig } from "./tool-guidance";

export interface SystemContextConfig {
  /** Instruction file discovery. Pass true for defaults, or provide config. Disabled when omitted. */
  instructions?: boolean | InstructionDiscoveryConfig;
  /** Environment context. Pass true for defaults, or provide config. Disabled when omitted. */
  environment?: boolean | EnvironmentContextConfig;
  /** Tool guidance config */
  toolGuidance?: ToolGuidanceConfig;
}

export interface SystemContext {
  /** Discovered instruction text (null if not found or disabled) */
  instructions: string | null;
  /** Formatted environment context (null if disabled) */
  environment: string | null;
  /** Tool guidance text (null if disabled) */
  toolGuidance: string | null;
  /** All sections joined with double newlines. Ready for prompt injection. */
  combined: string;
  /** Metadata about what was discovered */
  meta: {
    instructionSources?: DiscoveredInstructions["sources"];
    environmentContext?: EnvironmentContext;
  };
}

/**
 * Build the full system context for an agent session.
 * Each section is independently available or can be used via `combined`.
 *
 * Designed to be called once at init (system prompt is static for cache stability).
 */
export async function buildSystemContext(
  sandbox: Sandbox,
  config?: SystemContextConfig,
): Promise<SystemContext> {
  // Run discovery and environment collection in parallel
  const [instructions, env] = await Promise.all([
    config?.instructions !== false && config?.instructions !== undefined
      ? discoverInstructions(
          sandbox,
          typeof config.instructions === "object"
            ? config.instructions
            : undefined,
        )
      : null,
    config?.environment !== false && config?.environment !== undefined
      ? collectEnvironment(
          sandbox,
          typeof config.environment === "object"
            ? config.environment
            : undefined,
        )
      : null,
  ]);

  const instructionsText = instructions
    ? `# Project Instructions\n<INSTRUCTIONS>\n${instructions.text}\n</INSTRUCTIONS>`
    : null;

  const envCustom =
    config?.environment && typeof config.environment === "object"
      ? config.environment.custom
      : undefined;
  const environmentText = env ? formatEnvironment(env, envCustom) : null;

  const toolGuidanceText = config?.toolGuidance
    ? buildToolGuidance(config.toolGuidance)
    : null;

  const sections = [instructionsText, environmentText, toolGuidanceText]
    .filter(Boolean)
    .join("\n\n");

  return {
    instructions: instructionsText,
    environment: environmentText,
    toolGuidance: toolGuidanceText,
    combined: sections,
    meta: {
      instructionSources: instructions?.sources,
      environmentContext: env ?? undefined,
    },
  };
}
