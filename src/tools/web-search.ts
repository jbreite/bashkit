import { tool, zodSchema } from "ai";
import Parallel from "parallel-web";
import { z } from "zod";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  metadata?: Record<string, unknown>;
}

export interface WebSearchOutput {
  results: WebSearchResult[];
  total_results: number;
  query: string;
}

export interface WebSearchError {
  error: string;
  status_code?: number;
  retryable?: boolean;
}

const webSearchInputSchema = z.object({
  query: z.string().describe("The search query to use"),
  allowed_domains: z
    .array(z.string())
    .optional()
    .describe("Only include results from these domains"),
  blocked_domains: z
    .array(z.string())
    .optional()
    .describe("Never include results from these domains"),
});

type WebSearchInput = z.infer<typeof webSearchInputSchema>;

export interface WebSearchToolConfig {
  apiKey: string;
}

const RETRYABLE_CODES = [408, 429, 500, 502, 503];

export function createWebSearchTool(config: WebSearchToolConfig) {
  const { apiKey } = config;

  return tool({
    description:
      "Searches the web and returns formatted results. Use this to find current information, documentation, articles, and more.",
    inputSchema: zodSchema(webSearchInputSchema),
    execute: async (
      input: WebSearchInput,
    ): Promise<WebSearchOutput | WebSearchError> => {
      const { query, allowed_domains, blocked_domains } = input;

      try {
        const client = new Parallel({ apiKey });

        // Build source policy if domain filters provided
        const sourcePolicy:
          | { include_domains?: string[]; exclude_domains?: string[] }
          | undefined =
          allowed_domains || blocked_domains
            ? {
                ...(allowed_domains && { include_domains: allowed_domains }),
                ...(blocked_domains && { exclude_domains: blocked_domains }),
              }
            : undefined;

        const search = await client.beta.search({
          mode: "agentic",
          objective: query,
          max_results: 10,
          ...(sourcePolicy && { source_policy: sourcePolicy }),
        });

        // Transform Parallel response to WebSearchOutput
        const results: WebSearchResult[] = (search.results || []).map(
          (result) => ({
            title: result.title ?? "",
            url: result.url ?? "",
            snippet: result.excerpts?.join("\n") ?? "",
            metadata: result.publish_date
              ? { publish_date: result.publish_date }
              : undefined,
          }),
        );

        return {
          results,
          total_results: results.length,
          query,
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
