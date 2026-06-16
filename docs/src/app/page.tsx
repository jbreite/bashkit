"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "@base-ui-components/react/menu";
import { CodeBlock, CopyButton } from "./components/CodeBlock";
import { Footer } from "./Footer";

const managers = [
  { name: "npm", cmd: "install" },
  { name: "yarn", cmd: "add" },
  { name: "pnpm", cmd: "add" },
  { name: "bun", cmd: "add" },
];

function InstallSnippet() {
  const [active, setActive] = useState(0);
  const m = managers[active];
  const command = `${m.name} ${m.cmd} bashkit ai zod`;

  return (
    <div className="install-snippet">
      <code>
        <Menu.Root modal={false}>
          <Menu.Trigger openOnHover delay={0} className="install-mgr">
            {m.name}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="center" sideOffset={4}>
              <Menu.Popup className="install-mgr-popover">
                {managers.map((mgr, i) => (
                  <Menu.Item
                    key={mgr.name}
                    className={`install-mgr-option ${i === active ? "active" : ""}`}
                    onClick={() => setActive(i)}
                  >
                    {mgr.name}
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>{" "}
        {m.cmd} bashkit ai zod
      </code>
      <CopyButton
        text={command}
        size={15}
        className="install-snippet-copy"
        style={{
          padding: 0,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      />
    </div>
  );
}

export default function Home() {
  return (
    <>
      <article className="article">
        <header className="hero">
          <h1 id="hero-title">bashkit</h1>
          <p className="tagline">
            The{" "}
            <a
              href="https://platform.claude.com/docs/en/agent-sdk/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="tagline-brand"
            >
              {/* biome-ignore lint/performance/noImgElement: static export incompatible with next/image */}
              <img
                src="/claude-logo.jpg"
                alt="Claude"
                className="tagline-logo"
              />
              Claude Agents SDK
            </a>{" "}
            for the{" "}
            <a
              href="https://sdk.vercel.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="tagline-brand"
            >
              {/* biome-ignore lint/performance/noImgElement: static export incompatible with next/image */}
              <img
                src="/vercel-logo.png"
                alt="Vercel"
                className="tagline-logo"
              />
              Vercel AI SDK
            </a>
          </p>
          <InstallSnippet />
        </header>

        <section>
          <h2>What is bashkit?</h2>
          <p>
            BashKit is a runtime foundation for building AI coding agents on the{" "}
            <a
              href="https://sdk.vercel.ai"
              target="_blank"
              rel="noopener noreferrer"
            >
              Vercel AI SDK
            </a>
            . It gives models a coding surface, a sandbox-backed tool layer,
            Codemode orchestration, Codex-style plans, controller-managed
            subagents, budget controls, approvals, and host-facing runtime
            events.
          </p>
          <p>
            The goal is not just to call <code>Bash</code> from a model. It is
            to give host apps the primitives they need to build a Codex-like
            coding experience while still owning their server, storage, UI, and
            approval flow.
          </p>
        </section>

        <section>
          <h2>Runtime Primitives</h2>
          <ul>
            <li>
              <strong>Codemode</strong> &mdash; Let the model write code that
              orchestrates BashKit tools in batches
            </li>
            <li>
              <strong>Sandbox tools</strong> &mdash; Read, search, edit, write,
              and run commands through your chosen sandbox
            </li>
            <li>
              <strong>UpdatePlan</strong> &mdash; Maintain Codex-style progress
              state that host UIs can render
            </li>
            <li>
              <strong>Subagents</strong> &mdash; Spawn, list, wait for, and
              control focused child agents
            </li>
            <li>
              <strong>Runtime events</strong> &mdash; Observe tools, commands,
              plans, approvals, files, and agents through typed event sinks
            </li>
            <li>
              <strong>Cost controls</strong> &mdash; Track spend and share
              budget limits with parent and child runs
            </li>
          </ul>
        </section>

        <section>
          <h2>Quick Example</h2>
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

const { tools, planState } = await createAgentTools(sandbox, {
  runtime: {
    eventSink,
    planContext: {
      agent_id: 'main',
      thread_id: 'thread_123',
      turn_id: 'turn_456',
    },
  },
});

const { text } = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  tools,
  maxSteps: 20,
  prompt: 'Read the README and summarize this project.',
});

console.log(text);
console.log(planState.snapshot());
console.log(eventSink.events.map((event) => event.type));`}
          />
        </section>

        <section>
          <h2>Key Features</h2>
          <ul>
            <li>
              <strong>AI SDK Native</strong> &mdash; Tools, models, steps, and
              stop conditions stay in the Vercel AI SDK flow
            </li>
            <li>
              <strong>Codemode Ready</strong> &mdash; Expose one coding tool to
              the parent model while keeping direct tools inside the runtime
            </li>
            <li>
              <strong>Subagent Control Plane</strong> &mdash; Identity,
              profiles, lifecycle state, control-panel snapshots, and guardrails
              for child agents
            </li>
            <li>
              <strong>Runtime Events</strong> &mdash; Feed logs, progress
              panels, approval UI, and changes views from the same event stream
            </li>
            <li>
              <strong>Bring Your Own Sandbox</strong> &mdash; LocalSandbox for
              dev, VercelSandbox or E2BSandbox for production
            </li>
            <li>
              <strong>Type-Safe</strong> &mdash; Full TypeScript with Zod schema
              validation
            </li>
            <li>
              <strong>Configurable</strong> &mdash; Security controls, timeouts,
              and limits per tool
            </li>
            <li>
              <strong>Composable</strong> &mdash; Tools work together seamlessly
              in agentic loops
            </li>
            <li>
              <strong>Budget Tracking</strong> &mdash; Cumulative cost tracking
              with auto-stop
            </li>
            <li>
              <strong>Caching</strong> &mdash; Optional LRU caching for
              read-only tools
            </li>
            <li>
              <strong>Prompt Caching</strong> &mdash; Anthropic prompt cache
              middleware included
            </li>
          </ul>
        </section>

        <div className="quickstart-links">
          <p>
            <Link href="/getting-started">
              Getting Started <span className="arrow">&rarr;</span>
            </Link>
          </p>
          <p>
            <Link href="/tools">
              Explore Tools <span className="arrow">&rarr;</span>
            </Link>
          </p>
          <p>
            <Link href="/runtime">
              Runtime Events <span className="arrow">&rarr;</span>
            </Link>
          </p>
          <p>
            <Link href="/sandboxes">
              Sandbox Options <span className="arrow">&rarr;</span>
            </Link>
          </p>
          <p>
            <Link href="/api-reference">
              API Reference <span className="arrow">&rarr;</span>
            </Link>
          </p>
        </div>
      </article>

      <Footer />
    </>
  );
}
