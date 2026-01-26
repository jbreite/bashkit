import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { WebSearchConfig, WebSearchProvider } from "../types";
import {
  debugEnd,
  debugError,
  debugStart,
  isDebugEnabled,
} from "../utils/debug";
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

/**
 * Options for search providers.
 */
interface SearchOptions {
  query: string;
  allowedDomains: string[] | null;
  blockedDomains: string[] | null;
}

// Module cache for parallel-web to avoid repeated dynamic imports
let parallelModule: typeof import("parallel-web") | null = null;

async function getParallelModule() {
  if (!parallelModule) {
    try {
      parallelModule = await import("parallel-web");
    } catch {
      throw new Error(
        "WebSearch requires parallel-web. Install with: npm install parallel-web",
      );
    }
  }
  return parallelModule;
}

/**
 * Search using the Parallel provider.
 * Dynamic import ensures parallel-web is only loaded when used.
 */
async function searchWithParallel(
  apiKey: string,
  options: SearchOptions,
): Promise<WebSearchResult[]> {
  const { default: Parallel } = await getParallelModule();
  const client = new Parallel({ apiKey });

  // Build source policy if domain filters provided
  const sourcePolicy:
    | { include_domains?: string[]; exclude_domains?: string[] }
    | undefined =
    options.allowedDomains || options.blockedDomains
      ? {
          ...(options.allowedDomains && {
            include_domains: options.allowedDomains,
          }),
          ...(options.blockedDomains && {
            exclude_domains: options.blockedDomains,
          }),
        }
      : undefined;

  const search = await client.beta.search({
    mode: "agentic",
    objective: options.query,
    max_results: 10,
    ...(sourcePolicy && { source_policy: sourcePolicy }),
  });

  return (search.results || []).map((result) => ({
    title: result.title ?? "",
    url: result.url ?? "",
    snippet: result.excerpts?.join("\n") ?? "",
    metadata: result.publish_date
      ? { publish_date: result.publish_date }
      : undefined,
  }));
}

/**
 * Search using the configured provider.
 * Add new providers here as cases in the switch statement.
 */
async function searchContent(
  apiKey: string,
  provider: WebSearchProvider,
  options: SearchOptions,
): Promise<WebSearchResult[]> {
  switch (provider) {
    case "parallel":
      return searchWithParallel(apiKey, options);
    // Add new providers here:
    // case "serper":
    //   return searchWithSerper(apiKey, options);
    // case "tavily":
    //   return searchWithTavily(apiKey, options);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

const webSearchInputSchema = z.object({
  query: z.string().describe("The search query to use"),
  allowed_domains: z
    .array(z.string())
    .nullable()
    .default(null)
    .describe("Only include results from these domains"),
  blocked_domains: z
    .array(z.string())
    .nullable()
    .default(null)
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
  const {
    provider = "parallel",
    apiKey,
    strict,
    needsApproval,
    providerOptions,
  } = config;

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
      const startTime = performance.now();
      const debugId = isDebugEnabled()
        ? debugStart("web-search", { query, allowed_domains, blocked_domains })
        : "";

      try {
        const results = await searchContent(apiKey, provider, {
          query,
          allowedDomains: allowed_domains,
          blockedDomains: blocked_domains,
        });

        const durationMs = Math.round(performance.now() - startTime);
        if (debugId) {
          debugEnd(debugId, "web-search", {
            summary: { resultCount: results.length },
            output: results
              .slice(0, 5)
              .map((r) => ({ title: r.title, url: r.url })),
            duration_ms: durationMs,
          });
        }

        return {
          results,
          total_results: results.length,
          query,
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
              "web-search",
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
        if (debugId) debugError(debugId, "web-search", errorMessage);
        return { error: errorMessage };
      }
    },
  });
}
