import type { LanguageModel } from "ai";
import type { ZodError } from "zod";
import {
  serializedSubagentProfileConfigSchema,
  type SerializedSubagentProfile,
  type SerializedSubagentProfileDefaults,
} from "./profile-loader.schema";
import type {
  SubagentError,
  SubagentProfileDefaults,
  SubagentProfileInput,
} from "./types";

export interface LoadedSubagentProfiles {
  profiles: SubagentProfileInput[];
  defaults?: SubagentProfileDefaults;
  defaultProfile?: string;
}

export type SubagentProfileModelResolver = (
  modelAlias: string,
) => LanguageModel | SubagentError | null | undefined;

export interface SubagentProfileLoaderOptions {
  /** Map serialized model aliases to live AI SDK models. */
  models?: Record<string, LanguageModel>;
  /** Advanced resolver for aliases that are not covered by models. */
  resolveModel?: SubagentProfileModelResolver;
}

export interface SubagentProfileFileReader {
  readFile(path: string): Promise<string>;
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isSubagentError(value: unknown): value is SubagentError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
}

function resolveModelAlias(
  modelAlias: string | undefined,
  options: SubagentProfileLoaderOptions,
): LanguageModel | SubagentError | undefined {
  if (!modelAlias) return undefined;

  const mapped = options.models?.[modelAlias];
  if (mapped) return mapped;

  const resolved = options.resolveModel?.(modelAlias);
  if (!resolved) {
    return { error: `Unknown subagent model alias: ${modelAlias}` };
  }
  return resolved;
}

function toProfileInput(
  profile: SerializedSubagentProfile,
  options: SubagentProfileLoaderOptions,
): SubagentProfileInput | SubagentError {
  const model = resolveModelAlias(profile.model, options);
  if (isSubagentError(model)) return model;

  return {
    name: profile.name,
    description: profile.description,
    nickname: profile.nickname,
    model,
    system: profile.system,
    allowedTools: profile.allowedTools,
    deniedTools: profile.deniedTools,
    deniedBehavior: profile.deniedBehavior,
    codemode: profile.codemode,
    context: profile.context,
    cost: profile.cost,
    metadata: profile.metadata,
  };
}

function toProfileDefaults(
  defaults: SerializedSubagentProfileDefaults | undefined,
  options: SubagentProfileLoaderOptions,
): SubagentProfileDefaults | SubagentError | undefined {
  if (!defaults) return undefined;

  const model = resolveModelAlias(defaults.model, options);
  if (isSubagentError(model)) return model;

  return {
    model,
    system: defaults.system,
    allowedTools: defaults.allowedTools,
    deniedTools: defaults.deniedTools,
    deniedBehavior: defaults.deniedBehavior,
    codemode: defaults.codemode,
    context: defaults.context,
    cost: defaults.cost,
  };
}

export function loadSubagentProfilesFromObject(
  input: unknown,
  options: SubagentProfileLoaderOptions = {},
): LoadedSubagentProfiles | SubagentError {
  const parsed = serializedSubagentProfileConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: `Invalid subagent profile config: ${formatZodError(parsed.error)}`,
    };
  }

  const defaults = toProfileDefaults(parsed.data.defaults, options);
  if (defaults && "error" in defaults) return defaults;

  const profiles: SubagentProfileInput[] = [];
  for (const profile of parsed.data.profiles) {
    const runtimeProfile = toProfileInput(profile, options);
    if ("error" in runtimeProfile) return runtimeProfile;
    profiles.push(runtimeProfile);
  }

  return {
    profiles,
    defaults,
    defaultProfile: parsed.data.defaultProfile,
  };
}

export function loadSubagentProfilesFromJson(
  json: string,
  options: SubagentProfileLoaderOptions = {},
): LoadedSubagentProfiles | SubagentError {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch (error) {
    return {
      error: `Invalid subagent profile JSON: ${getErrorMessage(error)}`,
    };
  }

  return loadSubagentProfilesFromObject(input, options);
}

export async function loadSubagentProfilesFromFile(
  path: string,
  reader: SubagentProfileFileReader,
  options: SubagentProfileLoaderOptions = {},
): Promise<LoadedSubagentProfiles | SubagentError> {
  let json: string;
  try {
    json = await reader.readFile(path);
  } catch (error) {
    return {
      error: `Failed to read subagent profile file ${path}: ${getErrorMessage(
        error,
      )}`,
    };
  }

  return loadSubagentProfilesFromJson(json, options);
}
