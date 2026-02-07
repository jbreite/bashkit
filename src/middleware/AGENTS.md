# Middleware

The middleware module provides Vercel AI SDK middleware implementations for cross-cutting concerns in language model interactions. Currently focused on Anthropic's prompt caching feature, which reduces API costs and latency by caching frequently-used prompt segments (requires 3+ messages to activate). Middleware wraps language models to modify request params or post-process responses without changing tool or agent code.

## Files

| File | Purpose |
|------|---------|
| `anthropic-cache.ts` | Implements prompt caching middleware for Anthropic models (v2 and v3) |
| `index.ts` | Barrel export for all middleware implementations |

## Key Exports

- `anthropicPromptCacheMiddleware` -- V3 middleware for AI SDK v6+ that marks message parts with ephemeral cache control
- `anthropicPromptCacheMiddlewareV2` -- V2 middleware for AI SDK v5 with same caching behavior
- `addCacheMarker(message)` -- Internal function that adds `providerOptions.anthropic.cacheControl` to last content part
- `applyCacheMarkers(params)` -- Internal function that applies markers to last message and last non-assistant message

## Architecture

Both middleware variants share the same core logic through internal helper functions:

1. `applyCacheMarkers()` receives `params` with a `prompt: Message[]` array
2. Applies `addCacheMarker()` to two positions:
   - Last message in the array (most recent)
   - Last non-assistant message before the final message (typically user/system)
3. `addCacheMarker()` mutates the message by adding `providerOptions.anthropic.cacheControl: { type: "ephemeral" }` to the last content part

The V2/V3 split exists to support both AI SDK v5 (`LanguageModelV2Middleware`) and v6+ (`LanguageModelMiddleware` with `specificationVersion: "v3"`). Both use the same `transformParams` approach rather than `wrapGenerate`.

## Design Patterns

- **Middleware Pattern** -- Wraps language models via Vercel AI SDK's `wrapLanguageModel()` to inject cross-cutting concerns
- **Shared Implementation** -- V2 and V3 variants delegate to shared `applyCacheMarkers()` to avoid duplication
- **Mutation Over Immutability** -- Directly mutates message objects for performance (avoids deep cloning large prompt arrays)
- **Type Unions** -- Accepts `LanguageModelV2Message | LanguageModelV3Message` to handle both SDK versions
- **Provider-Specific Options** -- Uses `providerOptions.anthropic` to pass Anthropic-specific cache control without polluting generic message schema

## Integration Points

- **Depends on**: `@ai-sdk/provider` (types only), `ai` (types only)
- **Used by**: Application code in `examples/basic.ts`, `examples/pdf-processor.ts`
- **Exported from**: `src/index.ts` as top-level exports (lines 17-20)

No internal dependencies on other BashKit modules. Middleware is purely AI SDK integration.

## Common Modifications

### Adding a New Middleware

1. **Create middleware file** at `src/middleware/your-middleware.ts`:
   ```typescript
   import type { LanguageModelMiddleware } from 'ai';

   export const yourMiddleware: LanguageModelMiddleware = {
     specificationVersion: 'v3',
     transformParams: async ({ params }) => {
       // Modify params before model invocation
       return { ...params, /* modifications */ };
     },
     // OR use wrapGenerate for response post-processing:
     // wrapGenerate: async ({ doGenerate, params }) => {
     //   const result = await doGenerate();
     //   // Modify result
     //   return result;
     // }
   };
   ```

2. **Export from index.ts**: Add to `src/middleware/index.ts`
3. **Export from main**: Add to `src/index.ts` in the middleware section
4. **Document**: Update `CLAUDE.md` Task 4 example

**Gotcha**: Choose `transformParams` for request modification (pre-model) or `wrapGenerate` for response modification (post-model). Don't use both unless you need both stages.

### Supporting New AI SDK Versions

If AI SDK releases a v4 middleware interface:

1. **Add new variant** in `anthropic-cache.ts`:
   ```typescript
   export const anthropicPromptCacheMiddlewareV4: LanguageModelV4Middleware = {
     specificationVersion: 'v4',
     transformParams: async ({ params }) => applyCacheMarkers(params),
   };
   ```

2. **Update type unions** if message types change:
   ```typescript
   type Message = LanguageModelV2Message | LanguageModelV3Message | LanguageModelV4Message;
   ```

3. **Export new variant** from `index.ts` and `src/index.ts`

**Gotcha**: Verify that `applyCacheMarkers()` works with new message shapes. If content structure changes, you may need version-specific marker functions.

### Changing Cache Strategy

To modify which messages get cache markers:

1. **Edit `applyCacheMarkers()`** in `anthropic-cache.ts`
2. **Current strategy**: Mark last message + last non-assistant before it
3. **Alternative strategies**:
   - Mark only system messages: `messages.filter(m => m.role === 'system').forEach(addCacheMarker)`
   - Mark last N messages: `messages.slice(-N).forEach(addCacheMarker)`
   - Mark messages over size threshold: Check content length before marking

**Gotcha**: Anthropic caching requires minimum content size and at least 3 messages to activate. Marking too many small messages wastes cache marker overhead.

## Testing

**Test files**: None (no `tests/middleware/` directory exists)

**Coverage gaps**:
- No unit tests for `addCacheMarker()` or `applyCacheMarkers()`
- No tests verifying V2/V3 compatibility with actual AI SDK versions
- No tests for edge cases (empty messages, string content, missing content arrays)

**Manual testing**:
1. Run `examples/basic.ts` or `examples/pdf-processor.ts` with `ANTHROPIC_API_KEY`
2. Check Anthropic API logs for cache hits after 3+ messages
3. Verify `providerOptions.anthropic.cacheControl` in debug output

**How to test new middleware**:
1. Import in `examples/basic.ts`
2. Wrap model with `wrapLanguageModel({ model, middleware })`
3. Run with API key and verify expected behavior
4. Check console output or API logs for middleware effects

**Recommended tests to add**:
- Unit test that `addCacheMarker()` correctly mutates message objects
- Unit test that `applyCacheMarkers()` marks correct messages
- Integration test with mock AI SDK middleware interface
- Test that V2 and V3 produce identical cache markers
