import type {
  LanguageModelV2CallOptions,
  LanguageModelV2Message,
  LanguageModelV2Middleware,
} from "@ai-sdk/provider";

function ensureCacheMarker(message: LanguageModelV2Message | undefined): void {
  if (!message) return;
  if (!("content" in message)) return;

  const content = message.content;
  if (!content || !Array.isArray(content)) return;

  const lastPart = content.at(-1);
  if (!lastPart || typeof lastPart === "string") return;

  // Add cache control marker
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
 * Middleware that enables Anthropic's prompt caching feature.
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
export const anthropicPromptCacheMiddleware: LanguageModelV2Middleware = {
  transformParams: async ({
    params,
  }: {
    params: LanguageModelV2CallOptions;
  }) => {
    const messages = params.prompt;
    if (!messages || messages.length === 0) {
      return params;
    }
    ensureCacheMarker(messages.at(-1));
    ensureCacheMarker(
      messages
        .slice(0, -1)
        .findLast((m: LanguageModelV2Message) => m.role !== "assistant")
    );
    return {
      ...params,
      prompt: messages,
    };
  },
};
