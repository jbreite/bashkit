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
            BashKit provides a comprehensive toolkit for building AI coding
            agents using the{" "}
            <a
              href="https://sdk.vercel.ai"
              target="_blank"
              rel="noopener noreferrer"
            >
              Vercel AI SDK
            </a>
            . It bridges the gap between AI models and actual code execution
            environments, giving your agents the ability to run commands, read
            and modify files, search codebases, and more.
          </p>
          <p>
            Tool signatures are designed to match{" "}
            <strong>Claude Code patterns</strong>, so AI models already know how
            to use them effectively. Bring your own sandbox &mdash; start with{" "}
            <code>LocalSandbox</code> for development, swap to Vercel or E2B for
            production.
          </p>
        </section>

        <section>
          <h2>10 Tools</h2>
          <ul>
            <li>
              <strong>Bash</strong> &mdash; Execute shell commands with timeout
              control
            </li>
            <li>
              <strong>Read</strong> &mdash; Read files and list directories
            </li>
            <li>
              <strong>Write</strong> &mdash; Create or overwrite files
            </li>
            <li>
              <strong>Edit</strong> &mdash; Replace strings in existing files
            </li>
            <li>
              <strong>Glob</strong> &mdash; Find files by pattern matching
            </li>
            <li>
              <strong>Grep</strong> &mdash; Search file contents with regex
            </li>
            <li>
              <strong>WebSearch</strong> &mdash; Web search with domain
              filtering
            </li>
            <li>
              <strong>WebFetch</strong> &mdash; Fetch and extract web content
            </li>
            <li>
              <strong>Task</strong> &mdash; Spawn sub-agents for complex work
            </li>
            <li>
              <strong>TodoWrite</strong> &mdash; Manage structured task lists
            </li>
          </ul>
        </section>

        <section>
          <h2>Quick Example</h2>
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
  maxSteps: 20,
  prompt: 'Read the README and summarize this project.',
});

console.log(text);`}
          />
        </section>

        <section>
          <h2>Key Features</h2>
          <ul>
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
