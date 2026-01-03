import type { CacheEntry, CacheStore } from "./types";

/**
 * Minimal interface for Redis-like clients.
 * Compatible with `redis`, `ioredis`, and similar libraries.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string | string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}

/**
 * Options for Redis cache store.
 */
export interface RedisCacheStoreOptions {
  /** Key prefix for namespacing (default: "bashkit:") */
  prefix?: string;
}

/**
 * Creates a CacheStore from an existing Redis client.
 *
 * TTL is handled by the cached() wrapper, not Redis. This ensures
 * consistent TTL behavior across all cache backends.
 *
 * @param client - Your Redis client (redis, ioredis, etc.)
 * @param options - Configuration options (prefix)
 * @returns CacheStore compatible with bashkit caching
 *
 * @example
 * ```typescript
 * import { createClient } from "redis";
 * import { createRedisCacheStore, createAgentTools } from "bashkit";
 *
 * const redis = createClient();
 * await redis.connect();
 *
 * const store = createRedisCacheStore(redis);
 * const { tools } = createAgentTools(sandbox, { cache: store });
 * ```
 */
export function createRedisCacheStore(
  client: RedisClient,
  options: RedisCacheStoreOptions = {},
): CacheStore {
  const { prefix = "bashkit:" } = options;

  return {
    async get(key: string): Promise<CacheEntry | undefined> {
      const data = await client.get(`${prefix}${key}`);
      return data ? JSON.parse(data) : undefined;
    },

    async set(key: string, entry: CacheEntry): Promise<void> {
      await client.set(`${prefix}${key}`, JSON.stringify(entry));
    },

    async delete(key: string): Promise<void> {
      await client.del(`${prefix}${key}`);
    },

    async clear(): Promise<void> {
      const keys = await client.keys(`${prefix}*`);
      if (keys.length) await client.del(keys);
    },

    async size(): Promise<number> {
      const keys = await client.keys(`${prefix}*`);
      return keys.length;
    },
  };
}
