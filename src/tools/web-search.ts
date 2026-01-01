import { tool, zodSchema } from "ai";
import Parallel from "parallel-web";
import { z } from "zod";
import type { WebSearchConfig } from "../types";
import { RETRYABLE_STATUS_CODES } from "../utils/http-constants";

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

const WEB_SEARCH_DESCRIPTION = `Searches the web and returns results with links. Use this for accessing up-to-date information beyond your knowledge cutoff.

**Capabilities:**
- Provides current information for recent events and data
- Returns results formatted with titles, URLs, and snippets
- Supports domain filtering to include or block specific websites

**CRITICAL REQUIREMENT - You MUST follow this:**
After answering using search results, you MUST include a "Sources:" section listing relevant URLs as markdown hyperlinks:

Sources:
- [Source Title 1](https://example.com/1)
- [Source Title 2](https://example.com/2)

**Important - Use the correct year:**
When searching for recent information, documentation, or current events, use the current year in your query (e.g., "React documentation 2025" not "2024").

**Domain filtering:**
- allowed_domains: Only include results from these domains
- blocked_domains: Never include results from these domains`;

export function createWebSearchTool(config: WebSearchConfig) {
  const { apiKey, strict, needsApproval, providerOptions } = config;

  return tool({
    description: WEB_SEARCH_DESCRIPTION,
    inputSchema: zodSchema(webSearchInputSchema),
    strict,
    needsApproval,
    providerOptions,
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
