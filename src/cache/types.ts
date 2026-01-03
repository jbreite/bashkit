/**
 * Cache entry with result and timestamp for TTL checks.
 */
export interface CacheEntry<T = unknown> {
  result: T;
  timestamp: number;
}

/**
 * Cache store interface for tool result caching.
 * Supports both sync and async operations for different backends (LRU, Redis, etc.)
 */
export interface CacheStore<T = unknown> {
  /** Get cached entry by key */
  get(
    key: string,
  ): CacheEntry<T> | undefined | Promise<CacheEntry<T> | undefined>;
  /** Set cache entry */
  set(key: string, entry: CacheEntry<T>): void | Promise<void>;
  /** Delete cache entry */
  delete(key: string): void | Promise<void>;
  /** Clear all entries */
  clear(): void | Promise<void>;
  /** Get current cache size (optional, for stats) */
  size?(): number | Promise<number>;
}

/**
 * Options for the cached() tool wrapper.
 */
export interface CacheOptions {
  /** TTL in milliseconds (default: 5 minutes) */
  ttl?: number;
  /** Custom cache store (default: LRUCacheStore) */
  store?: CacheStore;
  /** Custom key generator */
  keyGenerator?: (toolName: string, params: unknown) => string;
  /** Enable debug logging for cache hits/misses */
  debug?: boolean;
  /** Callback when cache hit occurs */
  onHit?: (toolName: string, key: string) => void;
  /** Callback when cache miss occurs */
  onMiss?: (toolName: string, key: string) => void;
}

/**
 * Cache statistics returned by getStats().
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Current cache size */
  size: number;
}
