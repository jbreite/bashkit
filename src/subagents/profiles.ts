import type {
  ResolvedSubagentProfile,
  SubagentCodemodePolicy,
  SubagentContextPolicy,
  SubagentContextPolicyInput,
  SubagentCostPolicy,
  SubagentCostPolicyInput,
  SubagentError,
  SubagentProfileDefaults,
  SubagentProfileInput,
  SubagentProfileRegistry,
} from "./types";

export const DEFAULT_SUBAGENT_PROFILE_NAME = "worker";

export const DEFAULT_SUBAGENT_CONTEXT_POLICY: SubagentContextPolicy = {
  mode: "recent",
  turns: 3,
};

export const DEFAULT_SUBAGENT_CODEMODE_POLICY: SubagentCodemodePolicy = {
  enabled: true,
  exposeDirectTools: false,
};

export const DEFAULT_SUBAGENT_COST_POLICY: SubagentCostPolicy = {
  maxUsd: null,
  maxActiveAgents: 4,
  maxTotalAgents: 25,
  maxDepth: 2,
  maxMailboxMessages: 100,
  minWaitTimeoutMs: 100,
  maxWaitTimeoutMs: 30_000,
};

export function resolveSubagentContextPolicy(
  input: SubagentContextPolicyInput | undefined,
  fallback: SubagentContextPolicy = DEFAULT_SUBAGENT_CONTEXT_POLICY,
): SubagentContextPolicy | SubagentError {
  if (!input) return fallback;
  if (input === "none") return { mode: "none" };
  if (input === "all") return { mode: "all" };
  if ("recent_turns" in input) {
    if (!Number.isInteger(input.recent_turns) || input.recent_turns < 0) {
      return { error: "recent_turns must be a non-negative integer" };
    }
    return { mode: "recent", turns: input.recent_turns };
  }
  if (input.mode === "recent") {
    if (!Number.isInteger(input.turns) || input.turns < 0) {
      return { error: "recent context turns must be a non-negative integer" };
    }
  }
  return input;
}

export function resolveSubagentCostPolicy(
  input?: SubagentCostPolicyInput,
  fallback: SubagentCostPolicy = DEFAULT_SUBAGENT_COST_POLICY,
): SubagentCostPolicy {
  return {
    maxUsd: input?.maxUsd ?? fallback.maxUsd,
    maxActiveAgents: input?.maxActiveAgents ?? fallback.maxActiveAgents,
    maxTotalAgents: input?.maxTotalAgents ?? fallback.maxTotalAgents,
    maxDepth: input?.maxDepth ?? fallback.maxDepth,
    maxMailboxMessages:
      input?.maxMailboxMessages ?? fallback.maxMailboxMessages,
    minWaitTimeoutMs: input?.minWaitTimeoutMs ?? fallback.minWaitTimeoutMs,
    maxWaitTimeoutMs: input?.maxWaitTimeoutMs ?? fallback.maxWaitTimeoutMs,
  };
}

export function createSubagentProfileRegistry(options?: {
  profiles?: SubagentProfileInput[];
  defaults?: SubagentProfileDefaults;
  defaultProfile?: string;
}): SubagentProfileRegistry {
  const profiles = new Map<string, SubagentProfileInput>();
  const defaults = options?.defaults ?? {};
  const defaultProfile =
    options?.defaultProfile ?? DEFAULT_SUBAGENT_PROFILE_NAME;

  function register(profile: SubagentProfileInput): void {
    profiles.set(profile.name, profile);
  }

  register({
    name: DEFAULT_SUBAGENT_PROFILE_NAME,
    description:
      "General-purpose child agent for delegated implementation or investigation.",
    nickname: "worker",
  });

  for (const profile of options?.profiles ?? []) {
    register(profile);
  }

  return {
    register,
    has(name: string): boolean {
      return profiles.has(name);
    },
    resolve(
      name: string | undefined,
      overrides?: Partial<SubagentProfileInput>,
    ): ResolvedSubagentProfile | SubagentError {
      const profileName = name ?? defaultProfile;
      const profile = profiles.get(profileName);
      if (!profile)
        return { error: `Unknown subagent profile: ${profileName}` };

      const context = resolveSubagentContextPolicy(
        overrides?.context ?? profile.context ?? defaults.context,
      );
      if ("error" in context) return context;

      const baseCost = resolveSubagentCostPolicy(defaults.cost);
      const profileCost = resolveSubagentCostPolicy(profile.cost, baseCost);
      const cost = resolveSubagentCostPolicy(overrides?.cost, profileCost);

      const codemode: SubagentCodemodePolicy = {
        ...DEFAULT_SUBAGENT_CODEMODE_POLICY,
        ...defaults.codemode,
        ...profile.codemode,
        ...overrides?.codemode,
      };

      const metadata = {
        ...(profile.metadata ?? {}),
        ...(overrides?.metadata ?? {}),
      };

      return {
        name: profile.name,
        description:
          overrides?.description ??
          profile.description ??
          `Subagent profile ${profile.name}`,
        nickname: overrides?.nickname ?? profile.nickname ?? null,
        model: overrides?.model ?? profile.model ?? defaults.model,
        system: overrides?.system ?? profile.system ?? defaults.system ?? "",
        allowedTools: [
          ...(defaults.allowedTools ?? []),
          ...(profile.allowedTools ?? []),
          ...(overrides?.allowedTools ?? []),
        ],
        deniedTools: [
          ...(defaults.deniedTools ?? []),
          ...(profile.deniedTools ?? []),
          ...(overrides?.deniedTools ?? []),
        ],
        codemode,
        context,
        cost,
        metadata,
      };
    },
  };
}
