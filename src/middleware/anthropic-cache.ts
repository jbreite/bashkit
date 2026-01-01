import type {
  LanguageModelV2Message,
  LanguageModelV2Middleware,
  LanguageModelV3Message,
} from "@ai-sdk/provider";
import type { LanguageModelMiddleware } from "ai";

type Message = LanguageModelV2Message | LanguageModelV3Message;

/**
 * Adds cache control marker to a message's last content part.
 */
function addCacheMarker(message: Message | undefined): void {
  if (!message || !("content" in message)) return;

  const content = message.content;
  if (!content || !Array.isArray(content)) return;

  const lastPart = content.at(-1);
  if (!lastPart || typeof lastPart === "string") return;

  (lastPart as { providerOptions?: Record<string, unknown> }).providerOptions =
    {
      ...(lastPart as { providerOptions?: Record<string, unknown> })
        .providerOptions,
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
    };
}

/**
 * Applies cache markers to the last message and last non-assistant message.
 * Shared logic for both V2 and V3 middleware.
 */
function applyCacheMarkers<T extends { prompt: Message[] }>(params: T): T {
  const messages = params.prompt;
  if (!messages || messages.length === 0) return params;

  addCacheMarker(messages.at(-1));
  addCacheMarker(messages.slice(0, -1).findLast((m) => m.role !== "assistant"));

  return params;
}

/**
 * Middleware that enables Anthropic's prompt caching feature.
 * For AI SDK v5 (LanguageModelV2).
 *
 * @example
 * ```typescript
 * import { wrapLanguageModel } from 'ai';
 * import { anthropic } from '@ai-sdk/anthropic';
 * import { anthropicPromptCacheMiddlewareV2 } from 'bashkit';
 *
 * const model = wrapLanguageModel({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   middleware: anthropicPromptCacheMiddlewareV2,
 * });
 * ```
 */
export const anthropicPromptCacheMiddlewareV2: LanguageModelV2Middleware = {
  transformParams: async ({ params }) => applyCacheMarkers(params),
};

/**
 * Middleware that enables Anthropic's prompt caching feature.
 * For AI SDK v6+ (LanguageModelV3).
 *
 * @example
 * ```typescript
 * import { wrapLanguageModel } from 'ai';
 * import { anthropic } from '@ai-sdk/anthropic';
 * import { anthropicPromptCacheMiddleware } from 'bashkit';
 *
 * const model = wrapLanguageModel({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   middleware: anthropicPromptCacheMiddleware,
 * });
 * ```
 */
export const anthropicPromptCacheMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => applyCacheMarkers(params),
};
