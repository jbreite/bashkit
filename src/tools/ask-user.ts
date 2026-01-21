import { tool, zodSchema } from "ai";
import { z } from "zod";
import {
  debugEnd,
  debugError,
  debugStart,
  isDebugEnabled,
} from "../utils/debug";

// Option for structured questions
export interface QuestionOption {
  label: string;
  description?: string;
}

// Structured question with options
export interface StructuredQuestion {
  header?: string; // Short label (max 12 chars), displayed as chip/tag
  question: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

// Simple question output (backward compatible)
export interface AskUserSimpleOutput {
  question: string;
  awaiting_response: true;
}

// Structured questions output
export interface AskUserStructuredOutput {
  questions: StructuredQuestion[];
  awaiting_response: true;
}

export type AskUserOutput = AskUserSimpleOutput | AskUserStructuredOutput;

export interface AskUserError {
  error: string;
}

// Answer can be a string (simple) or object with answers keyed by question
export interface AskUserAnswerOutput {
  answer: string;
  answers?: Record<string, string | string[]>;
}

// Schema for option
const questionOptionSchema = z.object({
  label: z
    .string()
    .describe(
      "The display text for this option. Should be concise (1-5 words). Add '(Recommended)' suffix for suggested options.",
    ),
  description: z
    .string()
    .optional()
    .describe("Explanation of what this option means or its implications."),
});

// Schema for structured question
const structuredQuestionSchema = z.object({
  header: z
    .string()
    .optional()
    .describe(
      "Very short label displayed as a chip/tag (max 12 chars). Examples: 'Auth method', 'Library', 'Approach'.",
    ),
  question: z
    .string()
    .describe(
      "The complete question to ask the user. Should be clear and specific.",
    ),
  options: z
    .array(questionOptionSchema)
    .min(2)
    .max(4)
    .optional()
    .describe(
      "Available choices for this question. 2-4 options. An 'Other' option is automatically available to users.",
    ),
  multiSelect: z
    .boolean()
    .optional()
    .describe(
      "Set to true to allow the user to select multiple options instead of just one.",
    ),
});

// Input schema supports both simple question string and structured questions
const askUserInputSchema = z.object({
  question: z
    .string()
    .optional()
    .describe(
      "Simple question string (for backward compatibility). Use 'questions' for structured multi-choice.",
    ),
  questions: z
    .array(structuredQuestionSchema)
    .min(1)
    .max(4)
    .optional()
    .describe("Structured questions with options (1-4 questions)."),
});

type AskUserInput = z.infer<typeof askUserInputSchema>;

// Handler for simple questions (backward compatible)
export type AskUserResponseHandler = (
  question: string,
) => Promise<string> | string;

// Handler for structured questions
export type AskUserStructuredHandler = (
  questions: StructuredQuestion[],
) =>
  | Promise<Record<string, string | string[]>>
  | Record<string, string | string[]>;

const ASK_USER_DESCRIPTION = `Use this tool when you need to ask the user questions during execution.

**Capabilities:**
- Gather user preferences or requirements
- Clarify ambiguous instructions
- Get decisions on implementation choices
- Offer choices about what direction to take

**When to use:**
- You need clarification on ambiguous requirements
- Multiple valid approaches exist and user preference matters
- You're about to make a decision with significant consequences
- Required information is missing from the context

**When NOT to use:**
- You can make a reasonable assumption
- The question is trivial or can be inferred
- You're just being overly cautious

**Simple question format:**
Use the 'question' parameter for a single free-form question.

**Structured questions format:**
Use the 'questions' parameter for multiple-choice questions with options:
- 1-4 questions allowed
- Each question can have 2-4 options with labels and descriptions
- Use multiSelect: true to allow multiple answers
- Users can always select "Other" to provide custom text input
- Place recommended option first and add "(Recommended)" to label`;

export interface AskUserToolConfig {
  /** Handler for simple string questions */
  onQuestion?: AskUserResponseHandler;
  /** Handler for structured questions with options */
  onStructuredQuestions?: AskUserStructuredHandler;
}

/**
 * Creates a tool for asking the user clarifying questions.
 *
 * Supports both simple string questions and structured multi-choice questions.
 *
 * @param config - Configuration with optional handlers for questions
 */
export function createAskUserTool(
  config?: AskUserToolConfig | AskUserResponseHandler,
) {
  // Support both old signature (just handler) and new config object
  const normalizedConfig: AskUserToolConfig =
    typeof config === "function" ? { onQuestion: config } : (config ?? {});

  return tool({
    description: ASK_USER_DESCRIPTION,
    inputSchema: zodSchema(askUserInputSchema),
    execute: async (
      input: AskUserInput,
    ): Promise<AskUserOutput | AskUserError | AskUserAnswerOutput> => {
      const startTime = performance.now();
      const debugId = isDebugEnabled()
        ? debugStart("ask-user", {
            hasQuestion: !!input.question,
            questionCount: input.questions?.length ?? 0,
            question: input.question
              ? input.question.length > 100
                ? `${input.question.slice(0, 100)}...`
                : input.question
              : undefined,
          })
        : "";

      try {
        // Validate input - must have either question or questions
        if (!input.question && !input.questions) {
          const error = "Either 'question' or 'questions' must be provided";
          if (debugId) debugError(debugId, "ask-user", error);
          return { error };
        }

        // Handle structured questions
        if (input.questions && input.questions.length > 0) {
          if (normalizedConfig.onStructuredQuestions) {
            const answers = await normalizedConfig.onStructuredQuestions(
              input.questions,
            );
            // Return first answer as 'answer' for compatibility, plus all answers
            const firstKey = Object.keys(answers)[0];
            const firstAnswer = answers[firstKey];

            const durationMs = Math.round(performance.now() - startTime);
            if (debugId) {
              debugEnd(debugId, "ask-user", {
                summary: {
                  type: "structured",
                  answerCount: Object.keys(answers).length,
                },
                duration_ms: durationMs,
              });
            }

            return {
              answer: Array.isArray(firstAnswer)
                ? firstAnswer.join(", ")
                : firstAnswer,
              answers,
            };
          }

          // No handler - return awaiting state
          const durationMs = Math.round(performance.now() - startTime);
          if (debugId) {
            debugEnd(debugId, "ask-user", {
              summary: { type: "structured", awaiting: true },
              duration_ms: durationMs,
            });
          }
          return {
            questions: input.questions,
            awaiting_response: true,
          };
        }

        // Handle simple question (backward compatible)
        if (input.question) {
          if (normalizedConfig.onQuestion) {
            const answer = await normalizedConfig.onQuestion(input.question);

            const durationMs = Math.round(performance.now() - startTime);
            if (debugId) {
              debugEnd(debugId, "ask-user", {
                summary: { type: "simple", hasAnswer: true },
                duration_ms: durationMs,
              });
            }
            return { answer };
          }

          // No handler - return awaiting state
          const durationMs = Math.round(performance.now() - startTime);
          if (debugId) {
            debugEnd(debugId, "ask-user", {
              summary: { type: "simple", awaiting: true },
              duration_ms: durationMs,
            });
          }
          return {
            question: input.question,
            awaiting_response: true,
          };
        }

        const error = "No question provided";
        if (debugId) debugError(debugId, "ask-user", error);
        return { error };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (debugId) debugError(debugId, "ask-user", errorMessage);
        return { error: errorMessage };
      }
    },
  });
}
