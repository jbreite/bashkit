"use client";

import { CodeBlock } from "../components/CodeBlock";
import { Footer } from "../Footer";

function Prop({
  name,
  type,
  defaultValue,
  children,
}: {
  name: string;
  type: string;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="prop-item">
      <div className="prop-header">
        <span className="prop-name">{name}</span>
        <span className="prop-type">{type}</span>
        {defaultValue && (
          <span className="prop-default">default: {defaultValue}</span>
        )}
      </div>
      <p className="prop-desc">{children}</p>
    </div>
  );
}

export default function ApiReference() {
  return (
    <>
      <article className="article">
        <header>
          <h1>API Reference</h1>
          <p className="tagline">
            Configuration options, middleware, caching, and budget tracking.
          </p>
        </header>

        <section>
          <h2 id="create-agent-tools">createAgentTools</h2>
          <p>
            The main entry point. Creates all tools configured for a given
            sandbox.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { createLocalSandbox, createAgentTools } from 'bashkit';

const sandbox = createLocalSandbox({ workingDirectory: '.' });

const { tools, budget } = await createAgentTools(sandbox, {
  defaultTimeout: 30000,
  tools: { Bash: { timeout: 10000 } },
  webSearch: { apiKey: process.env.PARALLEL_API_KEY },
  cache: true,
  modelRegistry: { provider: 'openRouter' },
  budget: { maxUsd: 5.00 },
});`}
          />
          <p>Returns an object with:</p>
          <ul>
            <li>
              <code>tools</code> &mdash; Tool set for Vercel AI SDK
            </li>
            <li>
              <code>budget</code> &mdash; Budget tracker (when budget config
              provided)
            </li>
            <li>
              <code>openRouterModels</code> &mdash; Model registry map (when
              modelRegistry config provided)
            </li>
            <li>
              <code>contextLayers</code> &mdash; Applied context layers (empty
              array when no context config). Use with{" "}
              <code>applyContextLayers()</code> for late-added tools.
            </li>
          </ul>
        </section>

        <section>
          <h2 id="configuration">Configuration</h2>

          <h3>AgentConfig</h3>
          <div className="props-list">
            <Prop name="defaultTimeout" type="number" defaultValue="120000">
              Default timeout in milliseconds for all tools.
            </Prop>
            <Prop name="tools" type="ToolConfig">
              Per-tool configuration. Keys are tool names (Bash, Read, Write,
              etc.).
            </Prop>
            <Prop name="webSearch" type="WebSearchConfig">
              Web search configuration. Presence enables WebSearch and WebFetch
              tools.
            </Prop>
            <Prop name="cache" type="boolean | CacheConfig">
              Enable tool result caching. Pass <code>true</code> for defaults or
              an object for fine-grained control.
            </Prop>
            <Prop name="modelRegistry" type="ModelRegistryConfig">
              Fetch model info (pricing + context lengths) from a provider.
            </Prop>
            <Prop name="budget" type="BudgetConfig">
              Budget tracking configuration. Requires modelRegistry or
              pricingProvider.
            </Prop>
            <Prop name="context" type="ContextConfig">
              Context layer config. Opt-in &mdash; wraps tools with execution
              and output policies. See the{" "}
              <a href="/context">Context</a> page.
            </Prop>
          </div>

          <h3>ToolConfig (per-tool)</h3>
          <div className="props-list">
            <Prop name="timeout" type="number">
              Override timeout for this tool.
            </Prop>
            <Prop name="blockedCommands" type="string[]">
              Bash only. Commands that will be rejected.
            </Prop>
            <Prop name="allowedPaths" type="string[]">
              Read/Write only. Glob patterns for allowed file paths.
            </Prop>
            <Prop name="maxFileSize" type="number">
              Write only. Maximum file size in bytes.
            </Prop>
            <Prop name="maxOutputLength" type="number">
              Maximum output length before truncation.
            </Prop>
          </div>
        </section>

        <section>
          <h2 id="middleware">Middleware</h2>
          <p>
            BashKit includes middleware for the Vercel AI SDK&apos;s{" "}
            <code>wrapLanguageModel</code>:
          </p>

          <h3>anthropicPromptCacheMiddleware</h3>
          <p>
            Automatically adds cache control headers to Anthropic messages,
            reducing cost and latency for repeated prompts.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { anthropicPromptCacheMiddleware } from 'bashkit';
import { wrapLanguageModel } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const model = wrapLanguageModel({
  model: anthropic('claude-sonnet-4-5'),
  middleware: anthropicPromptCacheMiddleware,
});`}
          />
          <p>
            Effective when conversations have 3+ messages. The middleware marks
            the system prompt and early messages for caching.
          </p>
        </section>

        <section>
          <h2 id="caching">Caching</h2>
          <p>
            Optional LRU caching for tool execution results. Caches identical
            tool calls to avoid redundant work.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`// Enable with defaults (LRU, 5min TTL)
const { tools } = await createAgentTools(sandbox, { cache: true });

// Per-tool control
const { tools } = await createAgentTools(sandbox, {
  cache: {
    ttl: 10 * 60 * 1000, // 10 minutes
    debug: true,          // Log cache hits/misses
    Read: true,
    Glob: true,
    Grep: true,
    WebFetch: false,      // Disable for this tool
  },
});`}
          />
          <p>
            <strong>Default cached tools:</strong> Read, Glob, Grep, WebFetch,
            WebSearch
          </p>
          <p>
            <strong>Not cached by default:</strong> Bash, Write, Edit (they have
            side effects)
          </p>

          <h3>Standalone Caching</h3>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { cached } from 'bashkit';

const cachedTool = cached(myTool, 'MyTool', { ttl: 60000 });

// Check cache stats
const stats = cachedTool.getStats();
// { hits: 5, misses: 2, hitRate: 0.71, size: 2 }`}
          />
        </section>

        <section>
          <h2 id="budget-tracking">Budget Tracking</h2>
          <p>
            Track cumulative costs across agentic loop steps and stop when a
            budget is exceeded. Pricing data is auto-fetched from OpenRouter
            (free API, cached 24h).
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`const { tools, budget } = await createAgentTools(sandbox, {
  modelRegistry: { provider: 'openRouter' },
  budget: { maxUsd: 5.00 },
});

const result = await generateText({
  model,
  tools,
  stopWhen: [stepCountIs(50), budget.stopWhen],
  onStepFinish: (step) => {
    budget.onStepFinish(step);
    console.log(budget.getStatus());
    // { totalCostUsd: 0.12, maxUsd: 5, remainingUsd: 4.88, ... }
  },
});`}
          />
          <p>
            Budget tracking auto-wires into Task tool sub-agents when
            configured.
          </p>

          <h3>Model ID Matching</h3>
          <p>Uses PostHog&apos;s 3-tier matching strategy:</p>
          <ol>
            <li>Exact match (case-insensitive)</li>
            <li>
              Longest contained match (model variant contains cost variant)
            </li>
            <li>Reverse containment (cost variant contains model variant)</li>
          </ol>
        </section>

        <section>
          <h2 id="message-pruning">Message Pruning</h2>
          <p>
            Keep conversations within token limits by pruning older messages:
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { pruneMessages } from 'bashkit';

const pruned = pruneMessages(messages, {
  maxTokens: 100000,
  protectRecentUserMessages: 3,
});`}
          />
          <p>
            Removes the oldest messages first while protecting the most recent
            user messages and the system prompt.
          </p>
        </section>
      </article>

      <Footer />
    </>
  );
}
