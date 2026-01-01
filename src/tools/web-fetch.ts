import { generateText, tool, zodSchema } from "ai";
import Parallel from "parallel-web";
import { z } from "zod";
import type { WebFetchConfig } from "../types";
import { RETRYABLE_STATUS_CODES } from "../utils/http-constants";

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

const WEB_FETCH_DESCRIPTION = `
- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content and extracts text
- Processes the content with the prompt using the configured model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL. You should then make a new WebFetch request with the redirect URL to fetch the content.
`;

export function createWebFetchTool(config: WebFetchConfig) {
  const { apiKey, model, strict, needsApproval, providerOptions } = config;

  return tool({
    description: WEB_FETCH_DESCRIPTION,
    inputSchema: zodSchema(webFetchInputSchema),
    strict,
    needsApproval,
    providerOptions,
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
            retryable: RETRYABLE_STATUS_CODES.includes(statusCode),
          };
        }

        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
