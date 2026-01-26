/**
 * Mock for parallel-web module
 *
 * Provides a configurable mock of the Parallel class for testing
 * WebSearch and WebFetch tools without actual API calls.
 */

import { vi } from "vitest";

/**
 * Search result from parallel-web
 */
export interface MockSearchResult {
  title: string;
  url: string;
  excerpts?: string[];
  publish_date?: string;
}

/**
 * Extract result from parallel-web
 */
export interface MockExtractResult {
  url?: string;
  full_content?: string;
  excerpts?: string[];
}

/**
 * Configuration for mock Parallel client
 */
export interface MockParallelConfig {
  /** Search results to return */
  searchResults?: MockSearchResult[];
  /** Extract results to return */
  extractResults?: MockExtractResult[];
  /** Error to throw from search */
  searchError?: Error | { status: number; message: string };
  /** Error to throw from extract */
  extractError?: Error | { status: number; message: string };
}

/**
 * Creates a mock Parallel class
 */
export function createMockParallel(config: MockParallelConfig = {}) {
  return class MockParallel {
    beta = {
      search: vi.fn().mockImplementation(async () => {
        if (config.searchError) {
          throw config.searchError;
        }
        return {
          results: config.searchResults ?? [],
        };
      }),
      extract: vi.fn().mockImplementation(async () => {
        if (config.extractError) {
          throw config.extractError;
        }
        return {
          results: config.extractResults ?? [],
        };
      }),
    };
  };
}

/**
 * Default mock search results
 */
export const defaultMockSearchResults: MockSearchResult[] = [
  {
    title: "Example Result 1",
    url: "https://example.com/page1",
    excerpts: ["This is an excerpt from the first result."],
    publish_date: "2024-01-15",
  },
  {
    title: "Example Result 2",
    url: "https://example.com/page2",
    excerpts: ["This is an excerpt from the second result."],
  },
];

/**
 * Default mock extract results
 */
export const defaultMockExtractResults: MockExtractResult[] = [
  {
    url: "https://example.com/page",
    full_content: "This is the full content of the page.",
    excerpts: ["Excerpt 1", "Excerpt 2"],
  },
];

/**
 * Setup parallel-web mock with vi.doMock
 *
 * Call this at the top of your test file before importing tools.
 *
 * @example
 * ```typescript
 * import { setupParallelWebMock } from '@test/mocks/parallel-web';
 *
 * setupParallelWebMock({
 *   searchResults: [{ title: 'Test', url: 'https://test.com', excerpts: ['Test'] }],
 * });
 *
 * // Now import the tool
 * const { createWebSearchTool } = await import('@/tools/web-search');
 * ```
 */
export function setupParallelWebMock(config: MockParallelConfig = {}) {
  const MockParallel = createMockParallel(config);

  vi.doMock("parallel-web", () => ({
    default: MockParallel,
  }));

  return MockParallel;
}

/**
 * Reset parallel-web mock
 */
export function resetParallelWebMock() {
  vi.doUnmock("parallel-web");
}
