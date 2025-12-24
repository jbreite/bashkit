import { tool, zodSchema } from "ai";
import { z } from "zod";

export interface AskUserOutput {
  question: string;
  awaiting_response: true;
}

export interface AskUserError {
  error: string;
}

const askUserInputSchema = z.object({
  question: z
    .string()
    .describe("The question to ask the user. Be specific and concise."),
});

type AskUserInput = z.infer<typeof askUserInputSchema>;

export type AskUserResponseHandler = (
  question: string,
) => Promise<string> | string;

const ASK_USER_DESCRIPTION = `Ask the user a clarifying question when you need more information to proceed.

**When to use:**
- You need clarification on ambiguous requirements
- Multiple valid approaches exist and user preference matters
- You're about to make a decision with significant consequences
- Required information is missing from the context

**When NOT to use:**
- You can make a reasonable assumption
- The question is trivial or can be inferred
- You're just being overly cautious

Keep questions specific and actionable. Avoid yes/no questions when you need details.`;

/**
 * Creates a tool for asking the user clarifying questions.
 *
 * The response handler can be:
 * - Synchronous: returns the answer immediately
 * - Async: waits for user input (e.g., from a UI)
 * - Undefined: tool returns awaiting_response flag for external handling
 *
 * @param onQuestion - Optional callback to handle the question and return an answer
 */
export function createAskUserTool(onQuestion?: AskUserResponseHandler) {
  return tool({
    description: ASK_USER_DESCRIPTION,
    inputSchema: zodSchema(askUserInputSchema),
    execute: async ({
      question,
    }: AskUserInput): Promise<
      AskUserOutput | AskUserError | { answer: string }
    > => {
      try {
        if (onQuestion) {
          const answer = await onQuestion(question);
          return { answer };
        }

        // No handler - return awaiting state for external handling
        return {
          question,
          awaiting_response: true,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
