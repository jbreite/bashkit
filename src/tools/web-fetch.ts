import type { LanguageModel } from "ai";
import { generateText, tool, zodSchema } from "ai";
import Parallel from "parallel-web";
import { z } from "zod";

export interface WebFetchOutput {
  response: string;
  url: string;
  final_url?: string;
  status_code?: number;
}

export interface WebFetchError {
  error: string;
  status_code?: number;
  retryable?: boolean;
}

const webFetchInputSchema = z.object({
  url: z.string().describe("The URL to fetch content from"),
  prompt: z.string().describe("The prompt to run on the fetched content"),
});

type WebFetchInput = z.infer<typeof webFetchInputSchema>;

export interface WebFetchToolConfig {
  apiKey: string;
  model: LanguageModel;
}

const RETRYABLE_CODES = [408, 429, 500, 502, 503];

export function createWebFetchTool(config: WebFetchToolConfig) {
  const { apiKey, model } = config;

  return tool({
    description:
      "Fetches content from a URL and processes it with an AI model. Use this to analyze web pages, extract information, or summarize content.",
    inputSchema: zodSchema(webFetchInputSchema),
    execute: async (
      input: WebFetchInput,
    ): Promise<WebFetchOutput | WebFetchError> => {
      const { url, prompt } = input;

      try {
        const client = new Parallel({ apiKey });

        // Extract content from the URL
        const extract = await client.beta.extract({
          urls: [url],
          excerpts: true,
          full_content: true,
        });

        if (!extract.results || extract.results.length === 0) {
          return {
            error: "No content extracted from URL",
            status_code: 404,
            retryable: false,
          };
        }

        const extractedResult = extract.results[0] as {
          url?: string;
          title?: string;
          full_content?: string;
          excerpts?: string[];
        };

        // Get the content - prefer full_content, fallback to excerpts
        const content =
          extractedResult.full_content ||
          extractedResult.excerpts?.join("\n\n") ||
          "";

        if (!content) {
          return {
            error: "No content available from URL",
            status_code: 404,
            retryable: false,
          };
        }

        // Process content with the model
        const result = await generateText({
          model,
          prompt: `${prompt}\n\nContent from ${url}:\n\n${content}`,
        });

        return {
          response: result.text,
          url,
          final_url: extractedResult.url || url,
        };
      } catch (error) {
        // Handle Parallel API errors
        if (error && typeof error === "object" && "status" in error) {
          const statusCode = (error as { status: number }).status;
          const message =
            (error as { message?: string }).message || "API request failed";
          return {
            error: message,
            status_code: statusCode,
            retryable: RETRYABLE_CODES.includes(statusCode),
          };
        }

        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
