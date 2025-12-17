/**
 * Test the web tools directly without AI agent
 *
 * Run with: bun run examples/test-web-tools.ts
 *
 * Requires:
 *   - PARALLEL_API_KEY environment variable
 *   - ANTHROPIC_API_KEY environment variable (for WebFetch model)
 */

import { anthropic } from "@ai-sdk/anthropic";
import { createWebFetchTool, createWebSearchTool } from "../src";

// Helper to unwrap tool result (handles AI SDK's union type with AsyncIterable)
function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

async function unwrapToolResult<T>(result: T | AsyncIterable<T>): Promise<T> {
  if (isAsyncIterable<T>(result)) {
    // For streaming tools, collect all chunks (our tools don't stream, so this shouldn't happen)
    let lastValue: T | undefined;
    for await (const chunk of result) {
      lastValue = chunk;
    }
    if (lastValue === undefined) {
      throw new Error("No result from async iterable");
    }
    return lastValue;
  }
  return result;
}

async function main() {
  const parallelApiKey = process.env.PARALLEL_API_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!parallelApiKey) {
    console.error("❌ PARALLEL_API_KEY environment variable is required");
    process.exit(1);
  }

  if (!anthropicApiKey) {
    console.error("❌ ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  console.log("🧪 Testing bashkit web tools...\n");

  const toolOptions = { toolCallId: "test", messages: [] };

  // Test WebSearch
  console.log("🔍 Testing WebSearch tool...");
  const webSearch = createWebSearchTool({ apiKey: parallelApiKey });

  const searchResult = await unwrapToolResult(
    await webSearch.execute!(
      {
        query: "What is the Vercel AI SDK?",
      },
      toolOptions,
    ),
  );
  console.log("WebSearch result:");
  if ("error" in searchResult) {
    console.log("  Error:", searchResult.error);
  } else {
    console.log("  Total results:", searchResult.total_results);
    console.log("  Query:", searchResult.query);
    console.log("  First 3 results:");
    for (const result of searchResult.results.slice(0, 3)) {
      console.log(`    - ${result.title}`);
      console.log(`      URL: ${result.url}`);
      console.log(
        `      Snippet: ${result.snippet.slice(0, 100)}${
          result.snippet.length > 100 ? "..." : ""
        }`,
      );
    }
  }

  // Test WebSearch with domain filtering
  console.log("\n🔍 Testing WebSearch with domain filter...");
  const filteredSearchResult = await unwrapToolResult(
    await webSearch.execute!(
      {
        query: "AI SDK documentation",
        allowed_domains: ["vercel.com", "sdk.vercel.ai"],
      },
      toolOptions,
    ),
  );
  console.log("Filtered WebSearch result:");
  if ("error" in filteredSearchResult) {
    console.log("  Error:", filteredSearchResult.error);
  } else {
    console.log("  Total results:", filteredSearchResult.total_results);
    console.log("  Results from allowed domains only:");
    for (const result of filteredSearchResult.results.slice(0, 3)) {
      console.log(`    - ${result.title} (${result.url})`);
    }
  }

  // Test WebFetch
  console.log("\n📄 Testing WebFetch tool...");
  const webFetch = createWebFetchTool({
    apiKey: parallelApiKey,
    model: anthropic("claude-3-5-haiku-latest"),
  });

  const fetchResult = await unwrapToolResult(
    await webFetch.execute!(
      {
        url: "https://sdk.vercel.ai/docs/introduction",
        prompt: "Summarize this page in 2-3 sentences. What is the AI SDK?",
      },
      toolOptions,
    ),
  );
  console.log("WebFetch result:");
  if ("error" in fetchResult) {
    console.log("  Error:", fetchResult.error);
  } else {
    console.log("  URL:", fetchResult.url);
    if (fetchResult.final_url) {
      console.log("  Final URL:", fetchResult.final_url);
    }
    console.log("  Response:", fetchResult.response);
  }

  console.log("\n✅ Web tools tested successfully!");
}

main().catch(console.error);
