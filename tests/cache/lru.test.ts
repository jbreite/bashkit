import { describe, it, expect, beforeEach } from "vitest";
import { LRUCacheStore } from "@/cache/lru";
import type { CacheEntry } from "@/cache/types";

describe("LRUCacheStore", () => {
  let cache: LRUCacheStore<string>;

  beforeEach(() => {
    cache = new LRUCacheStore(3);
  });

  describe("basic operations", () => {
    it("should set and get values", () => {
      const entry: CacheEntry<string> = {
        result: "value1",
        timestamp: Date.now(),
      };
      cache.set("key1", entry);

      const retrieved = cache.get("key1");
      expect(retrieved).toEqual(entry);
    });

    it("should return undefined for missing keys", () => {
      const result = cache.get("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should delete values", () => {
      cache.set("key1", { result: "value1", timestamp: Date.now() });
      cache.delete("key1");

      expect(cache.get("key1")).toBeUndefined();
      expect(cache.size()).toBe(0);
    });

    it("should clear all values", () => {
      cache.set("key1", { result: "value1", timestamp: Date.now() });
      cache.set("key2", { result: "value2", timestamp: Date.now() });
      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeUndefined();
    });

    it("should report correct size", () => {
      expect(cache.size()).toBe(0);

      cache.set("key1", { result: "value1", timestamp: Date.now() });
      expect(cache.size()).toBe(1);

      cache.set("key2", { result: "value2", timestamp: Date.now() });
      expect(cache.size()).toBe(2);
    });
  });

  describe("LRU eviction", () => {
    it("should evict oldest entry when capacity is reached", () => {
      cache.set("key1", { result: "value1", timestamp: Date.now() });
      cache.set("key2", { result: "value2", timestamp: Date.now() });
      cache.set("key3", { result: "value3", timestamp: Date.now() });

      // Cache is now full (size 3)
      expect(cache.size()).toBe(3);

      // Adding a 4th item should evict key1 (oldest)
      cache.set("key4", { result: "value4", timestamp: Date.now() });

      expect(cache.size()).toBe(3);
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeDefined();
      expect(cache.get("key3")).toBeDefined();
      expect(cache.get("key4")).toBeDefined();
    });

    it("should update recency on get", () => {
      cache.set("key1", { result: "value1", timestamp: Date.now() });
      cache.set("key2", { result: "value2", timestamp: Date.now() });
      cache.set("key3", { result: "value3", timestamp: Date.now() });

      // Access key1 to make it most recent
      cache.get("key1");

      // Add new key, should evict key2 (now oldest)
      cache.set("key4", { result: "value4", timestamp: Date.now() });

      expect(cache.get("key1")).toBeDefined();
      expect(cache.get("key2")).toBeUndefined();
      expect(cache.get("key3")).toBeDefined();
      expect(cache.get("key4")).toBeDefined();
    });

    it("should update recency on set with existing key", () => {
      cache.set("key1", { result: "value1", timestamp: Date.now() });
      cache.set("key2", { result: "value2", timestamp: Date.now() });
      cache.set("key3", { result: "value3", timestamp: Date.now() });

      // Update key1 to make it most recent
      cache.set("key1", { result: "updated", timestamp: Date.now() });

      // Add new key, should evict key2 (now oldest)
      cache.set("key4", { result: "value4", timestamp: Date.now() });

      expect(cache.get("key1")?.result).toBe("updated");
      expect(cache.get("key2")).toBeUndefined();
      expect(cache.get("key3")).toBeDefined();
      expect(cache.get("key4")).toBeDefined();
    });
  });

  describe("default configuration", () => {
    it("should use default maxSize of 1000", () => {
      const defaultCache = new LRUCacheStore();

      // Add 1000 entries
      for (let i = 0; i < 1000; i++) {
        defaultCache.set(`key${i}`, {
          result: `value${i}`,
          timestamp: Date.now(),
        });
      }
      expect(defaultCache.size()).toBe(1000);

      // Adding 1001st should evict first
      defaultCache.set("key1000", {
        result: "value1000",
        timestamp: Date.now(),
      });
      expect(defaultCache.size()).toBe(1000);
      expect(defaultCache.get("key0")).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("should handle setting same key multiple times", () => {
      cache.set("key1", { result: "value1", timestamp: 100 });
      cache.set("key1", { result: "value2", timestamp: 200 });
      cache.set("key1", { result: "value3", timestamp: 300 });

      expect(cache.size()).toBe(1);
      expect(cache.get("key1")?.result).toBe("value3");
      expect(cache.get("key1")?.timestamp).toBe(300);
    });

    it("should handle deleting non-existent key", () => {
      cache.delete("nonexistent");
      expect(cache.size()).toBe(0);
    });

    it("should handle cache with maxSize of 1", () => {
      const tinyCache = new LRUCacheStore<string>(1);

      tinyCache.set("key1", { result: "value1", timestamp: Date.now() });
      expect(tinyCache.size()).toBe(1);

      tinyCache.set("key2", { result: "value2", timestamp: Date.now() });
      expect(tinyCache.size()).toBe(1);
      expect(tinyCache.get("key1")).toBeUndefined();
      expect(tinyCache.get("key2")).toBeDefined();
    });

    it("should preserve entry data exactly", () => {
      const timestamp = 1704067200000;
      const entry: CacheEntry<string> = { result: "test value", timestamp };

      cache.set("key", entry);
      const retrieved = cache.get("key");

      expect(retrieved?.result).toBe("test value");
      expect(retrieved?.timestamp).toBe(timestamp);
    });
  });

  describe("type safety", () => {
    it("should work with complex objects", () => {
      interface ComplexResult {
        data: string[];
        metadata: { count: number };
      }

      const complexCache = new LRUCacheStore<ComplexResult>(10);
      const entry: CacheEntry<ComplexResult> = {
        result: {
          data: ["a", "b", "c"],
          metadata: { count: 3 },
        },
        timestamp: Date.now(),
      };

      complexCache.set("key", entry);
      const retrieved = complexCache.get("key");

      expect(retrieved?.result.data).toEqual(["a", "b", "c"]);
      expect(retrieved?.result.metadata.count).toBe(3);
    });
  });
});
