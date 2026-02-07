# Cache Module

Provides tool result caching to reduce redundant executions for read-only tools like Read, Glob, Grep, WebFetch, and WebSearch. Supports both in-memory LRU caching and external stores like Redis, with TTL-based expiration and configurable per-tool enablement.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Core interfaces: CacheEntry, CacheStore, CacheOptions, CacheStats |
| `lru.ts` | In-memory LRU cache implementation (default store) |
| `cached.ts` | Tool wrapper function and cache key generation |
| `redis.ts` | Redis adapter for distributed caching |
| `index.ts` | Barrel exports for public API |

## Key Exports

- `cached(tool, toolName, options?)` -- Wraps a tool with caching, returns CachedTool with getStats() and clearCache()
- `LRUCacheStore(maxSize?)` -- In-memory LRU cache (default maxSize: 1000)
- `createRedisCacheStore(client, options?)` -- Adapts Redis client to CacheStore interface
- `CacheStore` -- Interface for cache backends (get, set, delete, clear, size?)
- `CacheOptions` -- Configuration: ttl, store, keyGenerator, debug, callbacks
- `CachedTool<T>` -- Tool extension with getStats() and clearCache() methods

## Architecture

**Data Flow**:
1. Tool execution → `cached.ts` checks cache via CacheStore.get(key)
2. Cache hit → Return cached result immediately
3. Cache miss → Execute tool, store result if successful (no 'error' property)
4. TTL checked on retrieval (stored timestamp vs current time)

**Key Generation** (`cached.ts:defaultKeyGenerator`):
- Serializes params to JSON with sorted keys (order-independent)
- SHA256 hash truncated to 16 chars for fixed-length keys
- Format: `{toolName}:{hash}` (e.g., `Read:a1b2c3d4e5f6g7h8`)

**Cache Store Abstraction**:
- `CacheStore` interface supports both sync (LRU) and async (Redis) operations
- `CacheEntry<T>` wraps result with timestamp for TTL checks
- TTL enforcement in `cached.ts`, not in stores (consistent behavior)

**LRU Implementation** (`lru.ts`):
- Map-based O(1) access, O(1) eviction
- Move-to-end on get() for recency tracking
- Evict oldest (first key) when maxSize reached

**Redis Adapter** (`redis.ts`):
- Compatible with `redis`, `ioredis`, and similar clients
- Key prefixing for namespacing (default: `bashkit:`)
- JSON serialization for CacheEntry storage
- TTL handled by cached() wrapper, not Redis EXPIRE

## Design Patterns

- **Wrapper Pattern** -- `cached()` wraps tools without modifying their structure
- **Strategy Pattern** -- CacheStore interface allows swapping backends (LRU, Redis)
- **Decorator Pattern** -- Adds getStats() and clearCache() methods to tools
- **Repository Pattern** -- CacheStore abstracts storage details from caching logic

## Integration Points

**Depends on**:
- `crypto` (Node.js built-in) -- SHA256 hashing for cache keys
- `ai` package -- Tool type definitions

**Used by**:
- `/src/tools/index.ts` -- `createAgentTools()` applies caching to selected tools
- `/src/types.ts` -- Imports CacheStore for AgentConfig type

**Exported from**:
- `/src/index.ts` -- Public API exports: `cached`, `LRUCacheStore`, `createRedisCacheStore`, types

**Tool Integration** (`/src/tools/index.ts`):
```typescript
// Resolves cache config → { store, ttl, debug, enabled }
const { store, ttl, debug, enabled } = resolveCache(config?.cache);

// Wraps each enabled tool
if (enabled.has('Read')) {
  tools.Read = cached(tools.Read, 'Read', { store, ttl, debug });
}
```

**Default Cacheable Tools**: Read, Glob, Grep, WebFetch, WebSearch (not Bash, Write, Edit due to side effects)

## Common Modifications

### Add a New Cache Backend
1. Create adapter function in new file (e.g., `memcached.ts`):
   ```typescript
   export function createMemcachedStore(client: MemcachedClient): CacheStore {
     return {
       async get(key: string): Promise<CacheEntry | undefined> { ... },
       async set(key: string, entry: CacheEntry): Promise<void> { ... },
       async delete(key: string): Promise<void> { ... },
       async clear(): Promise<void> { ... },
       async size(): Promise<number> { ... },
     };
   }
   ```
2. Export from `index.ts`
3. Document TTL handling (cached() wrapper manages it, not backend)

**Gotchas**:
- All methods can be sync or async (return `T | Promise<T>`)
- `size()` is optional (for stats only)
- Don't implement TTL in store (cached() handles expiration)

### Enable Caching for a Tool with Side Effects
1. In `/src/tools/index.ts`, add tool name to cache config check
2. Update `DEFAULT_CACHEABLE` if it should be cached by default
3. Ensure tool returns `{ error }` for failures (cached() only caches successes)

**Gotchas**:
- Only cache idempotent tools (repeated calls produce same result)
- Tools returning `{ error }` are never cached
- Cache key uses full params, so mutations in params bypass cache

### Customize Cache Key Generation
Pass custom `keyGenerator` to `cached()`:
```typescript
const myTool = cached(tool, 'MyTool', {
  keyGenerator: (toolName, params) => {
    const { file_path } = params as { file_path: string };
    return `${toolName}:${file_path}`;  // Use file_path directly
  }
});
```

**Gotchas**:
- Keys must be deterministic (same params → same key)
- Avoid sensitive data in keys (logged in debug mode)
- Redis keys should be short (default uses 16-char hash)

### Add Cache Metrics/Monitoring
Use `onHit` and `onMiss` callbacks:
```typescript
const { tools } = createAgentTools(sandbox, {
  cache: {
    debug: true,  // Logs hits/misses to console
    onHit: (tool, key) => metrics.increment(`cache.hit.${tool}`),
    onMiss: (tool, key) => metrics.increment(`cache.miss.${tool}`),
  }
});
```

Check stats programmatically:
```typescript
const readTool = tools.Read as CachedTool;
const stats = await readTool.getStats();
console.log(`Hit rate: ${stats.hitRate}, Size: ${stats.size}`);
```

## Testing

**Test Files**:
- `/tests/cache/lru.test.ts` -- LRU eviction, basic ops, edge cases (198 lines)
- `/tests/cache/cached.test.ts` -- Caching behavior, TTL, stats, callbacks (493 lines)

**Coverage**:
- ✅ LRU eviction policy (move-to-end, oldest-first removal)
- ✅ TTL expiration (default 5min, custom)
- ✅ Key generation (order-independent, deterministic)
- ✅ Error results not cached
- ✅ Stats tracking (hits, misses, hitRate, size)
- ✅ Custom stores, key generators, callbacks
- ⚠️ Redis adapter not tested (no live Redis required)

**Run Tests**:
```bash
bun test tests/cache/
```

**Manual Testing**:
```bash
# Test caching in tool factory (requires examples)
ANTHROPIC_API_KEY=xxx bun examples/basic.ts
# Check debug logs for cache hits/misses
```

**Gaps**:
- No integration tests with real Redis
- No concurrency tests for cache races
- No benchmarks for LRU vs Map performance
