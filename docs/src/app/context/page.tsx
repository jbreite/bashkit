"use client";

import { CodeBlock } from "../components/CodeBlock";
import { Footer } from "../Footer";

export default function Context() {
  return (
    <>
      <article className="article">
        <header>
          <h1>Context</h1>
          <p className="tagline">
            System prompt assembly, tool execution gating, and output policies.
          </p>
        </header>

        <section>
          <h2 id="overview">Overview</h2>
          <p>
            The context layer is an opt-in system that wraps your tools with
            cross-cutting behavior: blocking tools based on state (execution
            policy), truncating large outputs with redirection hints (output
            policy), and assembling a static system prompt from project docs and
            environment info.
          </p>
          <p>
            Enable it by passing a <code>context</code> config to{" "}
            <code>createAgentTools</code>:
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`const { tools, contextLayers } = await createAgentTools(sandbox, {
  context: {
    executionPolicy: { /* ... */ },
    outputPolicy: { maxOutputLength: 50000 },
    layers: [myCustomLayer],
    extraTools: { MyTool: myTool },
  },
});`}
          />
          <p>
            When <code>context</code> is omitted, tools work exactly as before
            &mdash; no wrapping, no overhead.
          </p>
        </section>

        <section>
          <h2 id="context-layers">Context Layers</h2>
          <p>
            A <code>ContextLayer</code> intercepts tool execution with two
            optional hooks:
          </p>
          <ul>
            <li>
              <code>beforeExecute</code> &mdash; return{" "}
              <code>{`{ error: string }`}</code> to block a tool call, or{" "}
              <code>undefined</code> to allow it
            </li>
            <li>
              <code>afterExecute</code> &mdash; transform the tool result (e.g.,
              truncate output)
            </li>
          </ul>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { withContext, applyContextLayers } from 'bashkit';
import type { ContextLayer } from 'bashkit';

const loggingLayer: ContextLayer = {
  beforeExecute: (toolName, params) => {
    console.log(\`Calling \${toolName}\`);
    return undefined; // allow execution
  },
  afterExecute: (toolName, params, result) => {
    console.log(\`\${toolName} returned\`);
    return result; // pass through unchanged
  },
};

// Wrap a single tool
const wrappedTool = withContext(myTool, 'MyTool', [loggingLayer]);

// Wrap an entire ToolSet
const wrappedTools = applyContextLayers(tools, [loggingLayer]);`}
          />
          <p>
            Layers compose in order: first <code>beforeExecute</code> rejection
            wins, <code>afterExecute</code> transforms pipe through
            sequentially.
          </p>
        </section>

        <section>
          <h2 id="execution-policy">Execution Policy</h2>
          <p>
            Gates tool execution based on state. The most common use case is
            plan mode &mdash; blocking write tools while allowing read-only
            tools.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { createExecutionPolicy } from 'bashkit';

// Plan mode: blocks Bash, Write, Edit by default
const policy = createExecutionPolicy(planModeState);

// Custom blocked tools
const policy = createExecutionPolicy(planModeState, {
  planModeBlockedTools: ['Bash', 'Write', 'Edit', 'WebFetch'],
});

// Custom predicate (independent of plan mode)
const policy = createExecutionPolicy(undefined, {
  shouldBlock: (toolName, params) => {
    if (toolName === 'Bash' && String(params.command).includes('rm')) {
      return 'Destructive commands are not allowed';
    }
    return undefined;
  },
});`}
          />
          <p>
            Tools stay registered in the tool set (prompt cache stable) &mdash;
            only execution is gated.
          </p>
        </section>

        <section>
          <h2 id="output-policy">Output Policy</h2>
          <p>
            Handles large tool outputs by truncating and injecting hints that
            tell the model how to access the full result.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { createOutputPolicy } from 'bashkit';

// Defaults: maxOutputLength 30000, redirectionThreshold 20000
const policy = createOutputPolicy();

// Custom thresholds
const policy = createOutputPolicy({
  maxOutputLength: 50000,
  redirectionThreshold: 40000,
  excludeTools: ['Read'],  // never truncate Read output
});`}
          />
          <p>
            When output exceeds <code>redirectionThreshold</code>, it gets
            truncated to <code>maxOutputLength</code> and a <code>_hint</code>{" "}
            field is added with tool-specific guidance (e.g., &quot;use{" "}
            <code>head</code>/<code>tail</code> to see specific parts&quot;).
          </p>

          <h3>Custom Hints</h3>
          <CodeBlock
            language="typescript"
            copyable
            code={`const policy = createOutputPolicy({
  // Simple per-tool hint strings
  hints: {
    Bash: 'Re-run with | head or | tail to see specific parts.',
    Grep: 'Narrow your pattern to reduce results.',
  },
  // Full control callback
  buildHint: (toolName, params, originalLength, result) => {
    if (toolName === 'Bash' && params.command === 'git log') {
      return 'Use git log with --oneline or -n to limit output.';
    }
    return undefined; // fall through to hints map / defaults
  },
});`}
          />

          <h3>Stash to Disk</h3>
          <p>
            Optionally save full output to disk before truncating, so the model
            can <code>Read</code> the file later:
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`const policy = createOutputPolicy({
  stashOutput: {
    sandbox,
    tools: ['Bash', 'Grep'],  // which tools get disk stash
    dir: '/tmp/.bashkit/tool-output',  // default
  },
});`}
          />
        </section>

        <section>
          <h2 id="system-prompt">System Prompt Assembly</h2>
          <p>
            <code>buildSystemContext</code> assembles a static system prompt
            from three sources: discovered project instructions (AGENTS.md /
            CLAUDE.md files), environment info (cwd, platform, git branch), and
            tool guidance.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { buildSystemContext } from 'bashkit';

const ctx = await buildSystemContext(sandbox, {
  instructions: true,  // discover AGENTS.md / CLAUDE.md files
  environment: true,   // collect cwd, shell, platform, git info
  toolGuidance: {
    tools: { Bash: 'Run shell commands', Read: 'Read files' },
  },
});

// Use in streamText
const result = await streamText({
  model,
  system: ctx.combined,  // all sections joined
  tools,
  messages,
});

// Or access individual sections
ctx.instructions  // project instructions text
ctx.environment   // environment XML block
ctx.toolGuidance  // tool hint list`}
          />
          <p>
            Call once at init &mdash; the output is deterministic and designed
            to stay stable across turns for Anthropic prompt caching.
          </p>
        </section>

        <section>
          <h2 id="prepare-step">prepareStep</h2>
          <p>
            <code>createPrepareStep</code> returns a callback for the AI
            SDK&apos;s <code>prepareStep</code> option. It composes message
            compaction, context status monitoring, and plan mode hints.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { createPrepareStep } from 'bashkit';

const prepareStep = createPrepareStep({
  compaction: {
    model,
    maxTokens: 128000,
    threshold: 0.7,
  },
  contextStatus: {
    maxTokens: 128000,
  },
  planModeState,
  extend: async (args) => {
    // Custom logic runs after built-in steps
    return {};
  },
});

const result = await streamText({
  model,
  tools,
  messages,
  prepareStep,
});`}
          />
          <p>
            <strong>Important:</strong> <code>prepareStep</code> never touches
            the <code>system</code> prompt &mdash; all dynamic content is
            injected as user messages to preserve prompt caching.
          </p>
        </section>

        <section>
          <h2 id="full-example">Full Example</h2>
          <CodeBlock
            language="typescript"
            copyable
            code={`import {
  createLocalSandbox,
  createAgentTools,
  buildSystemContext,
  createPrepareStep,
} from 'bashkit';
import { streamText } from 'ai';

const sandbox = createLocalSandbox({ workingDirectory: '.' });

const { tools, planModeState, contextLayers } = await createAgentTools(
  sandbox,
  {
    context: {
      executionPolicy: {},       // plan mode gating with defaults
      outputPolicy: {
        maxOutputLength: 50000,
        stashOutput: { sandbox, tools: ['Bash'] },
      },
    },
    budget: { maxUsd: 5.0 },
  },
);

const ctx = await buildSystemContext(sandbox, {
  instructions: true,
  environment: true,
});

const prepareStep = createPrepareStep({
  planModeState,
  contextStatus: { maxTokens: 128000 },
});

const result = await streamText({
  model,
  system: ctx.combined,
  tools,
  messages,
  prepareStep,
});`}
          />
        </section>
      </article>

      <Footer />
    </>
  );
}
