# Utils Module

Utilities for token estimation, conversation management, budget tracking, and tool execution tracing. This module provides the infrastructure for managing long-running agent conversations, staying within context limits, tracking cumulative costs, and debugging tool execution patterns.

## Files

| File | Purpose |
|------|---------|
| `prune-messages.ts` | Token estimation and message pruning to reduce context usage |
| `compact-conversation.ts` | AI-powered conversation summarization for context management |
| `context-status.ts` | Context window monitoring with usage thresholds and guidance |
| `budget-tracking.ts` | Cumulative cost tracking with OpenRouter pricing and budget enforcement |
| `debug.ts` | Tool execution tracing and debug event logging |
| `http-constants.ts` | Shared HTTP status codes for web tools |
| `index.ts` | Barrel exports for public API |

## Key Exports

**Token Estimation & Pruning** (`prune-messages.ts`):
- `estimateTokens(text: string): number` -- Rough token count (~4 chars per token)
- `estimateMessageTokens(message: ModelMessage): number` -- Token count for single message
- `estimateMessagesTokens(messages: ModelMessage[]): number` -- Token count for message array
- `pruneMessagesByTokens(messages: ModelMessage[], config?: PruneMessagesConfig): ModelMessage[]` -- Fast pruning by truncating tool call args/results
- `PruneMessagesConfig` -- Configuration for target tokens, savings threshold, protected messages

**Conversation Compaction** (`compact-conversation.ts`):
- `compactConversation(messages: ModelMessage[], config: CompactConversationConfig, state?: CompactConversationState): Promise<CompactConversationResult>` -- Async summarization preserving context
- `createCompactConfig(modelId: ModelContextLimit, summarizerModel: LanguageModel, overrides?): CompactConversationConfig` -- Helper to create config with model presets
- `MODEL_CONTEXT_LIMITS` -- Token limits for common models (Claude, GPT, Gemini)
- `CompactConversationConfig` -- Configuration for threshold, protected messages, summarizer model
- `CompactConversationState` -- Accumulated summary state across compactions
- `CompactConversationResult` -- Compacted messages, updated state, and didCompact flag

**Context Monitoring** (`context-status.ts`):
- `getContextStatus(messages: ModelMessage[], maxTokens: number, config?: ContextStatusConfig): ContextStatus` -- Get usage level with optional guidance
- `contextNeedsAttention(status: ContextStatus): boolean` -- True if high or critical
- `contextNeedsCompaction(status: ContextStatus): boolean` -- True if critical
- `ContextStatus` -- Usage metrics, status level (comfortable/elevated/high/critical), and guidance message
- `ContextMetrics` -- Base metrics (usedTokens, maxTokens, usagePercent)
- `ContextStatusLevel` -- Union type for status levels

**Debug Tracing** (`debug.ts`):
- `debugStart(tool: string, input?: Record<string, unknown>): string` -- Record tool start, returns event ID
- `debugEnd(id: string, tool: string, options: { output?, summary?, duration_ms }): void` -- Record tool success
- `debugError(id: string, tool: string, error: string | Error): void` -- Record tool error
- `pushParent(id: string): void` -- Push parent context for nested tool calls
- `popParent(): void` -- Pop parent context
- `isDebugEnabled(): boolean` -- Check if debug mode active
- `getDebugLogs(): DebugEvent[]` -- Get all debug events (memory mode only)
- `clearDebugLogs(): void` -- Reset debug state
- `reinitDebugMode(): void` -- Re-initialize from environment
- `DebugEvent` -- Debug event structure with id, timestamp, tool, event type, input/output, duration, parent

**Budget Tracking** (`budget-tracking.ts`):
- `createBudgetTracker(maxUsd: number, options?): BudgetTracker` -- Create a budget tracker for cumulative cost monitoring
- `fetchOpenRouterPricing(apiKey?): Promise<Map<string, ModelPricing>>` -- Fetch model pricing from OpenRouter's public API (cached 24h, concurrent-safe)
- `calculateStepCost(usage: LanguageModelUsage, pricing: ModelPricing): number` -- Calculate cost for a single step from token usage
- `searchModelInCosts(model: string, costsMap: Map<string, ModelPricing>): ModelPricing | undefined` -- 3-tier model ID matching (exact, contained, reverse)
- `getModelMatchVariants(model: string): string[]` -- Generate match variants for fuzzy model ID lookup
- `findPricingForModel(model: string, options?): ModelPricing | undefined` -- Find pricing checking overrides then OpenRouter cache
- `resetOpenRouterCache(): void` -- Reset module-level OpenRouter cache (for testing)
- `BudgetTracker` -- Interface with `onStepFinish`, `stopWhen`, and `getStatus` methods
- `BudgetStatus` -- Status object with totalCostUsd, remainingUsd, usagePercent, exceeded, unpricedSteps
- `ModelPricing` -- Per-token pricing (inputPerToken, outputPerToken, cacheReadPerToken?, cacheWritePerToken?)

**Constants** (`http-constants.ts`):
- `RETRYABLE_STATUS_CODES: number[]` -- HTTP status codes indicating retryable errors [408, 429, 500, 502, 503]

## Architecture

### Dependency Graph
```
http-constants.ts (standalone)
       ↓
debug.ts (standalone, uses http-constants)
       ↓
prune-messages.ts (standalone)
       ↓
compact-conversation.ts (depends on prune-messages for token estimation)
       ↓
context-status.ts (depends on prune-messages for token estimation)

budget-tracking.ts (standalone, depends on "ai" types only)
```

### Token Estimation Flow
All token estimation flows through `prune-messages.ts`:
1. `estimateTokens(text)` -- Base estimation (~4 chars per token)
2. `estimateMessageTokens(message)` -- Handles string, array content, tool calls/results
3. `estimateMessagesTokens(messages)` -- Sums individual message estimates

Used by both `compact-conversation.ts` and `context-status.ts` for consistency.

### Message Management Strategy
Three complementary approaches:

1. **Fast Pruning** (`pruneMessagesByTokens`):
   - Truncates tool call args and tool results in older messages
   - Preserves conversation structure (all messages remain)
   - Protects last N user messages + all subsequent messages
   - No AI model required, instant
   - Loses context from truncated data

2. **AI Summarization** (`compactConversation`):
   - Summarizes old messages using a fast model (e.g., Claude Haiku)
   - Replaces old messages with summary + recent messages
   - Preserves context through structured summary
   - Requires AI model call, async
   - Maintains stateful summary across compactions

3. **Context Monitoring** (`getContextStatus`):
   - Monitors usage levels (comfortable → elevated → high → critical)
   - Injects guidance messages to prevent agent rushing
   - Triggers compaction at critical threshold (default 85%)
   - No modification of messages, just monitoring

### Debug Architecture

**Modes** (controlled by `BASHKIT_DEBUG` env var):
- `off` -- No logging (default)
- `stderr` / `1` -- Human-readable output to stderr
- `json` -- JSON lines to stderr
- `memory` -- In-memory array (retrieve via `getDebugLogs()`)
- `file:/path/to/trace.jsonl` -- Write to file

**Event Lifecycle**:
1. Tool starts → `debugStart(tool, input)` → returns event ID
2. Tool succeeds → `debugEnd(id, tool, { output, summary, duration_ms })`
3. Tool fails → `debugError(id, tool, error)`

**Parent Tracking**:
- `pushParent(id)` before spawning nested tools (e.g., Task spawning subagent)
- `popParent()` after nested execution completes
- Events include `parent` field to reconstruct call hierarchy

**Data Truncation**:
- Strings truncated to 1000 chars
- Arrays truncated to 10 items
- Recursive summarization for nested objects (max depth: 5)

## Design Patterns

### Token Estimation Pattern
Simple heuristic (4 chars per token) provides fast, consistent estimates across the codebase. Not exact, but sufficient for threshold-based decisions. Centralized in `prune-messages.ts` to ensure consistency.

### Stateful Compaction Pattern
`compactConversation` maintains state across calls:
- State includes `conversationSummary` from previous compactions
- New compaction includes previous summary as context
- Prevents information loss across multiple compactions
- Caller responsible for persisting state

### Threshold-Based Guidance Pattern
`context-status.ts` uses configurable thresholds to categorize usage:
- Comfortable (< 50%): no action
- Elevated (50-70%): monitor but don't warn
- High (70-85%): inject guidance to prevent rushing
- Critical (85%+): suggest wrapping up or compacting

Custom guidance functions can access metrics for dynamic messages.

### Budget Tracking Pattern
`createBudgetTracker` returns a `BudgetTracker` with three methods designed for the Vercel AI SDK agentic loop:
- `onStepFinish(step)` -- Call from `onStepFinish` callback to accumulate cost
- `stopWhen` -- Compose with other `StopCondition`s in `stopWhen` array
- `getStatus()` -- Query current cost, remaining budget, and exceeded flag

Pricing is resolved synchronously from a pre-fetched map. OpenRouter pricing is fetched once (with 24h cache and concurrent deduplication) before creating the tracker. Model ID matching uses PostHog's 3-tier strategy: exact match, longest contained match, reverse containment. Per-model pricing lookups are cached within the tracker instance.

Steps with unknown models are tracked as `unpricedSteps` (cost $0). An optional `onUnpricedModel` callback fires once per unknown model.

### Environment-Driven Debug Pattern
Debug mode initialized once from `process.env.BASHKIT_DEBUG` on module load. Uses lazy singleton pattern to avoid race conditions. Tools call debug functions unconditionally; functions check mode internally.

## Integration Points

### Depends on
- `ai` -- `ModelMessage`, `LanguageModel`, `generateText` (for compact-conversation), `LanguageModelUsage`, `StepResult`, `StopCondition`, `ToolSet` (for budget-tracking)
- Node.js `fs` -- `appendFileSync` (for debug file mode)

### Used by
**All tools** (`src/tools/*.ts`):
- Import `debugStart`, `debugEnd`, `debugError` from `debug.ts`
- Import `RETRYABLE_STATUS_CODES` from `http-constants.ts` (web-search, web-fetch only)

**Core library**:
- No internal dependencies (except tools)
- Designed for use in agent loop implementations

### Exported from
All utilities exported from `src/index.ts`:
- Token functions: `estimateTokens`, `estimateMessageTokens`, `estimateMessagesTokens`, `pruneMessagesByTokens`
- Compaction: `compactConversation`, `createCompactConfig`, `MODEL_CONTEXT_LIMITS`
- Context: `getContextStatus`, `contextNeedsAttention`, `contextNeedsCompaction`
- Budget: `createBudgetTracker`
- Debug: `clearDebugLogs`, `getDebugLogs`, `isDebugEnabled`, `reinitDebugMode`
- Types: `PruneMessagesConfig`, `CompactConversationConfig`, `CompactConversationState`, `CompactConversationResult`, `ContextStatus`, `ContextStatusConfig`, `ContextStatusLevel`, `ContextMetrics`, `DebugEvent`, `ModelContextLimit`, `BudgetTracker`, `BudgetStatus`, `ModelPricing`

## Common Modifications

### Adding a New Model to Context Limits
**Files**: `compact-conversation.ts`

1. Add model to `MODEL_CONTEXT_LIMITS` constant:
```typescript
export const MODEL_CONTEXT_LIMITS = {
  // ... existing models
  "new-model-id": 500_000,
} as const;
```

2. Type `ModelContextLimit` auto-updates via `keyof typeof`

### Customizing Pruning Strategy
**Files**: `prune-messages.ts`

Current strategy prunes tool call args and tool results. To prune different content:

1. Modify `pruneMessageContent()` for assistant messages
2. Modify `pruneToolMessage()` for tool messages
3. Update `pruneMessagesByTokens()` to call new pruning functions

**Gotcha**: Protected messages (last N user messages + all subsequent) are never pruned. Adjust `protectLastNUserMessages` config if needed.

### Adding a New Debug Mode
**Files**: `debug.ts`

1. Add mode to `DebugMode` type:
```typescript
type DebugMode = "off" | "stderr" | "json" | "memory" | "file" | "yourmode";
```

2. Update `initDebugMode()` to parse env var:
```typescript
if (envValue === "yourmode") {
  state.mode = "yourmode";
}
```

3. Add case to `emitEvent()`:
```typescript
case "yourmode":
  // Your output logic
  break;
```

### Customizing Context Guidance Messages
**Files**: `context-status.ts`

Two approaches:

1. **String replacement**:
```typescript
getContextStatus(messages, maxTokens, {
  highGuidance: "Custom message for high usage",
  criticalGuidance: "Custom message for critical usage"
});
```

2. **Dynamic function**:
```typescript
getContextStatus(messages, maxTokens, {
  highGuidance: (metrics) => `Usage: ${metrics.usagePercent.toFixed(2)}. Custom logic here.`
});
```

### Adjusting Compaction Thresholds
**Files**: `compact-conversation.ts`

Default: compact at 85% of max tokens. To change:

```typescript
compactConversation(messages, {
  maxTokens: 200_000,
  compactionThreshold: 0.75,  // Compact at 75% instead
  protectRecentMessages: 15,  // Protect last 15 messages instead of 10
  summarizerModel: haiku,
  taskContext: "Original user goal"
});
```

**Gotcha**: Lower threshold = more frequent compactions (higher API cost). Higher threshold = less runway for final response.

## Testing

### Test Files
- `/tests/utils/prune-messages.test.ts` -- Comprehensive unit tests for token estimation and pruning
- `/tests/utils/budget-tracking.test.ts` -- Comprehensive unit tests for budget tracking (cost calculation, model matching, OpenRouter fetch, tracker lifecycle)

### Coverage
- **Tested**: `prune-messages.ts` (estimateTokens, estimateMessageTokens, estimateMessagesTokens, pruneMessagesByTokens), `budget-tracking.ts` (calculateStepCost, searchModelInCosts, getModelMatchVariants, findPricingForModel, createBudgetTracker, fetchOpenRouterPricing)
- **Not tested**: `compact-conversation.ts`, `context-status.ts`, `debug.ts`, `http-constants.ts`

### Running Tests
```bash
bun run test tests/utils/prune-messages.test.ts
bun run test tests/utils/budget-tracking.test.ts
```

### Testing Debug Mode
Manual testing via environment variable:

```bash
# Human-readable output
BASHKIT_DEBUG=stderr bun examples/basic.ts

# JSON output
BASHKIT_DEBUG=json bun examples/basic.ts

# File output
BASHKIT_DEBUG=file:/tmp/trace.jsonl bun examples/basic.ts

# Memory mode (programmatic access)
BASHKIT_DEBUG=memory bun examples/basic.ts
# Then call getDebugLogs() in code
```

### Testing Compaction
No unit tests. Test via integration:

```typescript
import { compactConversation, createCompactConfig, MODEL_CONTEXT_LIMITS } from 'bashkit';
import { anthropic } from '@ai-sdk/anthropic';

const config = createCompactConfig(
  'claude-sonnet-4-5',
  anthropic('claude-haiku-4')
);

let state = { conversationSummary: '' };
const result = await compactConversation(messages, config, state);
// Check: result.didCompact, result.messages.length, result.state
```
