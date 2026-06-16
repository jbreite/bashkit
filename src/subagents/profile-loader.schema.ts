import { z } from "zod";
import type { JsonValue } from "./types";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const serializedSubagentContextPolicySchema = z.union([
  z.literal("none"),
  z.literal("all"),
  z.object({ recent_turns: z.number().int().nonnegative() }),
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("all") }),
  z.object({
    mode: z.literal("recent"),
    turns: z.number().int().nonnegative(),
  }),
]);

export const serializedSubagentCodemodePolicySchema = z.object({
  enabled: z.boolean().optional(),
  exposeDirectTools: z.boolean().optional(),
  includeTools: z.array(z.string()).optional(),
  excludeTools: z.array(z.string()).optional(),
});

export const serializedSubagentCostPolicySchema = z.object({
  maxUsd: z.number().positive().optional(),
  maxActiveAgents: z.number().int().positive().optional(),
  maxTotalAgents: z.number().int().positive().optional(),
  maxDepth: z.number().int().nonnegative().optional(),
  maxMailboxMessages: z.number().int().positive().optional(),
  minWaitTimeoutMs: z.number().int().nonnegative().optional(),
  maxWaitTimeoutMs: z.number().int().nonnegative().optional(),
});

const serializedSubagentProfileBaseSchema = z.object({
  description: z.string().optional(),
  nickname: z.string().optional(),
  model: z.string().optional(),
  system: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).optional(),
  deniedBehavior: z.enum(["reject", "hide"]).optional(),
  codemode: serializedSubagentCodemodePolicySchema.optional(),
  context: serializedSubagentContextPolicySchema.optional(),
  cost: serializedSubagentCostPolicySchema.optional(),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
});

export const serializedSubagentProfileSchema =
  serializedSubagentProfileBaseSchema.extend({
    name: z.string().min(1),
  });

export const serializedSubagentProfileDefaultsSchema =
  serializedSubagentProfileBaseSchema;

export const serializedSubagentProfileConfigSchema = z.object({
  defaultProfile: z.string().optional(),
  defaults: serializedSubagentProfileDefaultsSchema.optional(),
  profiles: z.array(serializedSubagentProfileSchema),
});

export type SerializedSubagentContextPolicy = z.infer<
  typeof serializedSubagentContextPolicySchema
>;
export type SerializedSubagentCodemodePolicy = z.infer<
  typeof serializedSubagentCodemodePolicySchema
>;
export type SerializedSubagentCostPolicy = z.infer<
  typeof serializedSubagentCostPolicySchema
>;
export type SerializedSubagentProfile = z.infer<
  typeof serializedSubagentProfileSchema
>;
export type SerializedSubagentProfileDefaults = z.infer<
  typeof serializedSubagentProfileDefaultsSchema
>;
export type SerializedSubagentProfileConfig = z.infer<
  typeof serializedSubagentProfileConfigSchema
>;
