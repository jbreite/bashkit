import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { SDKToolOptions } from "../types";

// --- Schemas ---

const questionOptionSchema = z.object({
  label: z
    .string()
    .describe(
      "User-facing label (1-5 words). Put the recommended option first and suffix its label with '(Recommended)'.",
    ),
  description: z
    .string()
    .describe(
      "One short sentence explaining the impact or tradeoff if this option is selected.",
    ),
});

const questionSchema = z.object({
  id: z
    .string()
    .describe(
      "Stable identifier for mapping answers. Use snake_case, e.g. 'time_period' or 'auth_method'.",
    ),
  header: z
    .string()
    .describe(
      "Short header label shown in the UI (12 or fewer chars). Examples: 'Auth method', 'Library', 'Approach'.",
    ),
  question: z.string().describe("Single-sentence prompt shown to the user."),
  options: z
    .array(questionOptionSchema)
    .min(2)
    .max(3)
    .describe(
      "2-3 mutually exclusive choices. Do not include an 'Other' option; the client adds a free-form 'Other' option automatically.",
    ),
  multiSelect: z
    .boolean()
    .nullable()
    .default(null)
    .describe(
      "Set to true to allow the user to select multiple options instead of just one.",
    ),
});

const askUserInputSchema = z.object({
  questions: z
    .array(questionSchema)
    .min(1)
    .max(4)
    .describe("1-4 questions to ask the user. Prefer 1, do not exceed 4."),
});

// --- Types ---

export type AskUserInput = z.infer<typeof askUserInputSchema>;
export type AskUserQuestion = z.infer<typeof questionSchema>;
export type AskUserQuestionOption = z.infer<typeof questionOptionSchema>;

/** Answers keyed by question id */
export type AskUserAnswers = Record<string, string | string[]>;

/** Tool output returned later by the client keyed by question id */
export type AskUserOutput = AskUserAnswers;

// --- Tool description ---

const ASK_USER_DESCRIPTION = `Request structured user input with 1-4 short questions. Each question must have 2-3 mutually exclusive options. Wait for the response before continuing.

**When to use:**
- Multiple valid approaches exist and user preference matters
- You're about to make a decision with significant consequences
- Required information is missing from the context

**When NOT to use:**
- You can make a reasonable assumption or infer the answer
- You just need to ask a free-form question (use your normal response instead)

**Format:**
- Prefer 1 question, do not exceed 4
- Each question needs a unique 'id' (snake_case), a short 'header' (≤12 chars), and 2-3 options
- Put the recommended option first and suffix its label with "(Recommended)"
- Do not include an "Other" option; the client adds one automatically
- Use multiSelect: true only when the user should select multiple options`;

// --- Config ---

export type AskUserToolConfig = SDKToolOptions;

/**
 * Creates a tool for asking the user clarifying questions.
 *
 * Always uses a `questions` array (even for a single question).
 * Each question has a stable `id` so answers are keyed deterministically.
 *
 * This tool is intentionally deferred: it emits a tool call for the client to
 * render, and the caller is expected to provide the tool output later.
 *
 * @param config - Optional AI SDK tool options
 */
export function createAskUserTool(config: AskUserToolConfig = {}) {
  return tool({
    description: ASK_USER_DESCRIPTION,
    inputSchema: zodSchema(askUserInputSchema),
    ...config,
  });
}
