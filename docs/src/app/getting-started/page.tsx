"use client";

import { CodeBlock } from "../components/CodeBlock";
import { Footer } from "../Footer";

export default function GettingStarted() {
  return (
    <>
      <article className="article">
        <header>
          <h1>Getting Started</h1>
          <p className="tagline">
            Start with a sandbox, then wire the runtime pieces that make a
            coding agent observable and controllable.
          </p>
        </header>

        <section>
          <h2 id="installation">Installation</h2>
          <p>
            Install bashkit along with its peer dependencies, an AI provider of
            your choice, and Cloudflare Codemode if you want the recommended
            batched coding surface:
          </p>
          <CodeBlock
            language="bash"
            copyable
            code={`npm install bashkit ai zod @ai-sdk/anthropic @cloudflare/codemode`}
          />
          <p>
            Any{" "}
            <a
              href="https://sdk.vercel.ai/docs/foundations/providers-and-models"
              target="_blank"
              rel="noopener noreferrer"
            >
              Vercel AI SDK provider
            </a>{" "}
            works &mdash; <code>@ai-sdk/anthropic</code>,{" "}
            <code>@ai-sdk/openai</code>, <code>@ai-sdk/google</code>, etc.
          </p>
          <p>
            For web search and fetch capabilities, add the optional{" "}
            <code>parallel-web</code> package:
          </p>
          <CodeBlock
            language="bash"
            copyable
            code={`npm install parallel-web`}
          />
        </section>

        <section>
          <h2 id="basic-setup">Recommended Setup</h2>
          <p>
            The most complete BashKit setup gives the parent model a compact
            control surface, keeps file and command tools behind Codemode,
            records runtime events, tracks plan state, and exposes subagent
            controls.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { DynamicWorkerExecutor } from '@cloudflare/codemode';
import {
  createAgentTools,
  createLocalSandbox,
  createMemoryRuntimeEventSink,
} from 'bashkit';

const sandbox = createLocalSandbox({
  workingDirectory: '/path/to/project',
});

const eventSink = createMemoryRuntimeEventSink();

const {
  tools,
  planState,
  budget,
  getSubagentControlPanelState,
} = await createAgentTools(sandbox, {
  runtime: {
    eventSink,
    planContext: {
      agent_id: 'main',
      thread_id: 'thread_123',
      turn_id: 'turn_456',
    },
  },
  codemode: {
    executor: new DynamicWorkerExecutor({ loader: env.LOADER }),
    includeTools: ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write'],
  },
  subagents: {
    model,
    profiles: [
      {
        name: 'researcher',
        allowedTools: ['Read', 'Glob', 'Grep'],
        deniedTools: ['Write', 'Edit', 'Bash'],
      },
    ],
  },
  modelRegistry: { provider: 'openRouter' },
  budget: { maxUsd: 2.00 },
});

eventSink.subscribe((event) => {
  console.log(event.type, event.timestamp);
});

console.log(planState.snapshot());
console.log(budget?.getStatus());
console.log(await getSubagentControlPanelState?.());`}
          />

          <h3>What the Model Sees</h3>
          <p>
            With <code>codemode</code> configured, the parent model gets a
            smaller, higher-level surface: Codemode for coding work,{" "}
            <code>UpdatePlan</code> for progress, and subagent control tools for
            delegation. Direct file and command tools remain available inside
            Codemode and child agents according to policy.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`Object.keys(tools);

// [
//   'UpdatePlan',
//   'codemode',
//   'SpawnAgent',
//   'ListAgents',
//   'WaitAgent',
//   'CancelAgent',
//   'MessageAgent'
// ]`}
          />

          <h3>Direct Tools Fallback</h3>
          <p>
            If you omit <code>codemode</code>, BashKit exposes direct tools such
            as <code>Bash</code>, <code>Read</code>, <code>Write</code>,{" "}
            <code>Edit</code>, <code>Glob</code>, and <code>Grep</code> to the
            parent model.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`const { tools } = await createAgentTools(sandbox);

// tools now includes direct sandbox tools plus UpdatePlan.`}
          />
        </section>

        <section>
          <h2 id="agentic-loop">Agentic Loop</h2>
          <p>
            Here&apos;s a complete example using the Vercel AI SDK&apos;s{" "}
            <code>generateText</code> with bashkit tools in an agentic loop:
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import {
  createAgentTools,
  createLocalSandbox,
  createMemoryRuntimeEventSink,
} from 'bashkit';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const sandbox = createLocalSandbox({ workingDirectory: '.' });
const eventSink = createMemoryRuntimeEventSink();

const { tools, budget } = await createAgentTools(sandbox, {
  runtime: {
    eventSink,
    planContext: {
      agent_id: 'main',
      thread_id: 'thread_123',
      turn_id: 'turn_456',
    },
  },
  modelRegistry: { provider: 'openRouter' },
  budget: { maxUsd: 2.00 },
});

const { text } = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  tools,
  maxSteps: 20,
  system: \`You are a helpful coding assistant. Use the tools
available to you to help the user with their request.
Always read files before modifying them.\`,
  onStepFinish: (step) => {
    budget?.onStepFinish(step);
  },
  prompt: 'Find all TypeScript files with TODO comments and list them.',
});

console.log(text);
console.log(eventSink.events);

// Clean up when done
await sandbox.destroy();`}
          />

          <h3>With Web Tools</h3>
          <p>
            To enable <code>WebSearch</code> and <code>WebFetch</code>, pass a{" "}
            <code>webSearch</code> config with your Parallel API key:
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`const { tools } = await createAgentTools(sandbox, {
  webSearch: {
    apiKey: process.env.PARALLEL_API_KEY,
  },
  webFetch: {
    apiKey: process.env.PARALLEL_API_KEY,
    model,
  },
});

// tools now also includes: WebSearch, WebFetch`}
          />
        </section>
      </article>

      <Footer />
    </>
  );
}
