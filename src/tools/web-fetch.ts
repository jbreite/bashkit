import { generateText, tool, zodSchema } from "ai";
import { z } from "zod";
import type { WebFetchConfig, WebFetchProvider } from "../types";
import {
  debugEnd,
  debugError,
  debugStart,
  isDebugEnabled,
} from "../utils/debug";
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

/**
 * Result from a web fetch provider's extract operation.
 * New providers should return this shape.
 */
export interface ExtractResult {
  content: string;
  finalUrl?: string;
}

// Module cache for parallel-web to avoid repeated dynamic imports
let parallelModule: typeof import("parallel-web") | null = null;

async function getParallelModule() {
  if (!parallelModule) {
    try {
      parallelModule = await import("parallel-web");
    } catch {
      throw new Error(
        "WebFetch requires parallel-web. Install with: npm install parallel-web",
      );
    }
  }
  return parallelModule;
}

/**
 * Fetch content using the Parallel provider.
 * Dynamic import ensures parallel-web is only loaded when used.
 */
async function fetchWithParallel(
  url: string,
  apiKey: string,
): Promise<ExtractResult> {
  const { default: Parallel } = await getParallelModule();
  const client = new Parallel({ apiKey });

  const extract = await client.beta.extract({
    urls: [url],
    excerpts: true,
    full_content: true,
  });

  if (!extract.results || extract.results.length === 0) {
    throw new Error("No content extracted from URL");
  }

  const result = extract.results[0] as {
    url?: string;
    full_content?: string;
    excerpts?: string[];
  };

  const content = result.full_content || result.excerpts?.join("\n\n") || "";

  if (!content) {
    throw new Error("No content available from URL");
  }

  return {
    content,
    finalUrl: result.url,
  };
}

/**
 * Fetch content using the configured provider.
 * Add new providers here as cases in the switch statement.
 */
async function fetchContent(
  url: string,
  apiKey: string,
  provider: WebFetchProvider,
): Promise<ExtractResult> {
  switch (provider) {
    case "parallel":
      return fetchWithParallel(url, apiKey);
    // Add new providers here:
    // case "firecrawl":
    //   return fetchWithFirecrawl(url, apiKey);
    // case "jina":
    //   return fetchWithJina(url, apiKey);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
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
  const {
    provider = "parallel",
    apiKey,
    model,
    strict,
    needsApproval,
    providerOptions,
  } = config;

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
      const startTime = performance.now();
      const debugId = isDebugEnabled()
        ? debugStart("web-fetch", {
            url,
            prompt: prompt.length > 200 ? `${prompt.slice(0, 200)}...` : prompt,
          })
        : "";

      try {
        const { content, finalUrl } = await fetchContent(url, apiKey, provider);

        // Process content with the model
        const result = await generateText({
          model,
          prompt: `${prompt}\n\nContent from ${url}:\n\n${content}`,
        });

        const durationMs = Math.round(performance.now() - startTime);
        if (debugId) {
          debugEnd(debugId, "web-fetch", {
            summary: {
              contentLength: content.length,
              responseLength: result.text.length,
            },
            duration_ms: durationMs,
          });
        }

        return {
          response: result.text,
          url,
          final_url: finalUrl || url,
        };
      } catch (error) {
        // Handle provider API errors
        if (error && typeof error === "object" && "status" in error) {
          const statusCode = (error as { status: number }).status;
          const message =
            (error as { message?: string }).message || "API request failed";
          if (debugId)
            debugError(
              debugId,
              "web-fetch",
              `${message} (status: ${statusCode})`,
            );
          return {
            error: message,
            status_code: statusCode,
            retryable: RETRYABLE_STATUS_CODES.includes(statusCode),
          };
        }

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (debugId) debugError(debugId, "web-fetch", errorMessage);
        return { error: errorMessage };
      }
    },
  });
}
