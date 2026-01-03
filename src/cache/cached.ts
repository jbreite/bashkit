import { createHash } from "crypto";
import type { Tool } from "ai";
import type { CacheOptions, CacheStats } from "./types";
import { LRUCacheStore } from "./lru";

/**
 * Generates a deterministic cache key from tool name and params.
 * Uses SHA256 hash (truncated to 16 chars) for fixed-length, Redis-safe keys.
 */
function defaultKeyGenerator(toolName: string, params: unknown): string {
  const sortedKeys =
    params && typeof params === "object"
      ? Object.keys(params as object).sort()
      : undefined;
  const serialized = JSON.stringify(params, sortedKeys);
  const hash = createHash("sha256")
    .update(serialized)
    .digest("hex")
    .slice(0, 16);
  return `${toolName}:${hash}`;
}

/**
 * Extended tool with cache methods.
 */
export type CachedTool<T extends Tool = Tool> = T & {
  /** Get cache statistics (hits, misses, hitRate, size) */
  getStats(): Promise<CacheStats>;
  /** Clear cache. Pass key to clear specific entry, or no args to clear all. */
  clearCache(key?: string): Promise<void>;
};

/**
 * Wraps an AI SDK tool with caching capabilities.
 *
 * Caches successful tool results (results without an 'error' property).
 * Cache hits return immediately without re-executing the tool.
 *
 * @param tool - The AI SDK tool to wrap
 * @param toolName - Name used in cache keys (e.g., 'Read', 'Glob')
 * @param options - Cache configuration options
 * @returns Cached tool with getStats() and clearCache() methods
 *
 * @example
 * ```typescript
 * import { cached, LRUCacheStore } from 'bashkit';
 *
 * const cachedReadTool = cached(readTool, 'Read', {
 *   ttl: 5 * 60 * 1000,  // 5 minutes
 *   debug: true,
 * });
 *
 * // Check stats (async for Redis compatibility)
 * console.log(await cachedReadTool.getStats());
 * // { hits: 5, misses: 2, hitRate: 0.71, size: 2 }
 * ```
 */
export function cached<T extends Tool>(
  tool: T,
  toolName: string,
  options: CacheOptions = {},
): CachedTool<T> {
  const {
    ttl = 5 * 60 * 1000, // 5 minutes default
    store = new LRUCacheStore(),
    keyGenerator = defaultKeyGenerator,
    debug = false,
    onHit,
    onMiss,
  } = options;

  let hits = 0;
  let misses = 0;
  const log = debug ? console.log.bind(console) : () => {};

  const cachedTool = {
    ...tool,
    execute: async (
      params: Parameters<NonNullable<T["execute"]>>[0],
      execOptions: Parameters<NonNullable<T["execute"]>>[1],
    ) => {
      const key = keyGenerator(toolName, params);
      const now = Date.now();

      // Check cache
      const entry = await store.get(key);
      if (entry && now - entry.timestamp < ttl) {
        hits++;
        log(`[Cache] HIT ${toolName}:${key.slice(-8)}`);
        onHit?.(toolName, key);
        return entry.result;
      }

      // Execute tool
      misses++;
      log(`[Cache] MISS ${toolName}:${key.slice(-8)}`);
      onMiss?.(toolName, key);
      if (!tool.execute) {
        throw new Error(`Tool ${toolName} has no execute function`);
      }
      const result = await tool.execute(params, execOptions);

      // Only cache successful results (no 'error' property)
      if (result && typeof result === "object" && !("error" in result)) {
        await store.set(key, { result, timestamp: now });
        log(`[Cache] STORED ${toolName}:${key.slice(-8)}`);
      }

      return result;
    },

    async getStats(): Promise<CacheStats> {
      const total = hits + misses;
      const size = (await store.size?.()) ?? 0;
      return {
        hits,
        misses,
        hitRate: total > 0 ? hits / total : 0,
        size,
      };
    },

    async clearCache(key?: string): Promise<void> {
      if (key) {
        await store.delete(key);
      } else {
        await store.clear();
      }
    },
  };

  return cachedTool as CachedTool<T>;
}
