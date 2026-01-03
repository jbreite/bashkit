import type { CacheEntry, CacheStore } from "./types";

/**
 * LRU (Least Recently Used) cache implementation.
 *
 * Uses a Map for O(1) access. When items are retrieved, they're moved to the
 * end (most recently used). When capacity is reached, the oldest (first) entry
 * is removed.
 *
 * @example
 * ```typescript
 * const cache = new LRUCacheStore(1000);
 * cache.set('key', { result: data, timestamp: Date.now() });
 * const entry = cache.get('key');
 * ```
 */
export class LRUCacheStore<T = unknown> implements CacheStore<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  get(key: string): CacheEntry<T> | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, entry);
    }
    return entry;
  }

  set(key: string, entry: CacheEntry<T>): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Delete oldest (first key)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, entry);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
