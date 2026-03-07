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
            Install bashkit, set up a sandbox, and run your first agentic loop.
          </p>
        </header>

        <section>
          <h2 id="installation">Installation</h2>
          <p>
            Install bashkit along with its peer dependencies and an AI provider
            of your choice:
          </p>
          <CodeBlock
            language="bash"
            copyable
            code={`npm install bashkit ai zod @ai-sdk/anthropic`}
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
          <h2 id="basic-setup">Basic Setup</h2>
          <p>
            The simplest way to get started is with <code>LocalSandbox</code>,
            which uses Bun/Node APIs directly &mdash; no network overhead, no
            extra dependencies.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { createLocalSandbox, createAgentTools } from 'bashkit';

// Create a sandbox pointing at your working directory
const sandbox = createLocalSandbox({
  workingDirectory: '/path/to/project',
});

// Create the tool set
const { tools } = await createAgentTools(sandbox);

// tools now contains: Bash, Read, Write, Edit, Glob, Grep`}
          />

          <h3>With Configuration</h3>
          <p>You can customize tool behavior with the config object:</p>
          <CodeBlock
            language="typescript"
            copyable
            code={`const { tools } = await createAgentTools(sandbox, {
  defaultTimeout: 30000,
  tools: {
    Bash: {
      timeout: 10000,
      blockedCommands: ['rm -rf /', 'dd if='],
    },
    Write: {
      maxFileSize: 1_000_000,
    },
  },
});`}
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
});

// tools now also includes: WebSearch, WebFetch`}
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
            code={`import { createLocalSandbox, createAgentTools } from 'bashkit';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const sandbox = createLocalSandbox({ workingDirectory: '.' });
const { tools } = await createAgentTools(sandbox);

const { text } = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  tools,
  maxSteps: 50,
  system: \`You are a helpful coding assistant. Use the tools
available to you to help the user with their request.
Always read files before modifying them.\`,
  prompt: 'Find all TypeScript files with TODO comments and list them.',
});

console.log(text);

// Clean up when done
await sandbox.destroy();`}
          />

          <h3>With Budget Tracking</h3>
          <p>Track costs and stop when a budget is exceeded:</p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { createLocalSandbox, createAgentTools } from 'bashkit';
import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const sandbox = createLocalSandbox({ workingDirectory: '.' });
const { tools, budget } = await createAgentTools(sandbox, {
  modelRegistry: { provider: 'openRouter' },
  budget: { maxUsd: 2.00 },
});

const { text } = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  tools,
  maxSteps: 50,
  stopWhen: [stepCountIs(50), budget.stopWhen],
  onStepFinish: (step) => {
    budget.onStepFinish(step);
    const status = budget.getStatus();
    console.log(\`Cost: $\${status.totalCostUsd.toFixed(4)}\`);
  },
  prompt: 'Refactor the utils directory to use consistent naming.',
});

console.log(text);
await sandbox.destroy();`}
          />
        </section>
      </article>

      <Footer />
    </>
  );
}
