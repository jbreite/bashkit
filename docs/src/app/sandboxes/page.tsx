"use client";

import { CodeBlock } from "../components/CodeBlock";
import { Footer } from "../Footer";

export default function Sandboxes() {
  return (
    <>
      <article className="article">
        <header>
          <h1>Sandboxes</h1>
          <p className="tagline">
            Execution environments for bashkit tools. Choose the right sandbox
            for your use case.
          </p>
        </header>

        <section>
          <h2 id="sandbox-interface">Sandbox Interface</h2>
          <p>
            All sandboxes implement the same interface. Tools depend on this
            abstraction, not specific implementations &mdash; so you can swap
            sandboxes without changing tool code.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`interface Sandbox {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  fileExists(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  destroy(): Promise<void>;
  readonly id?: string;  // For reconnection (cloud only)
  rgPath?: string;       // Path to ripgrep binary
}`}
          />
        </section>

        <section>
          <h2 id="local-sandbox">LocalSandbox</h2>
          <p>
            Uses Bun/Node APIs directly. The fastest option with zero network
            overhead. Best for development and local testing.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { createLocalSandbox } from 'bashkit';

const sandbox = createLocalSandbox({
  workingDirectory: '/path/to/project',
});

// No extra dependencies needed
// Fastest execution — direct system calls
// No isolation — runs on your machine`}
          />
          <ul>
            <li>
              <strong>No extra dependencies</strong> &mdash; works out of the
              box
            </li>
            <li>
              <strong>Fastest execution</strong> &mdash; direct Bun/Node API
              calls
            </li>
            <li>
              <strong>No isolation</strong> &mdash; commands run on your machine
            </li>
            <li>
              <strong>Best for</strong> &mdash; development, local testing,
              CI/CD
            </li>
          </ul>
        </section>

        <section>
          <h2 id="vercel-sandbox">VercelSandbox</h2>
          <p>
            Runs in Vercel&apos;s Firecracker micro-VMs. Provides full isolation
            with fast boot times. Requires the <code>@vercel/sandbox</code>{" "}
            package.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { createVercelSandbox, createAgentTools } from 'bashkit';

// Async — auto-sets up ripgrep
const sandbox = await createVercelSandbox();

const { tools } = await createAgentTools(sandbox);
// Grep tool works immediately — rgPath is pre-configured

// Clean up when done
await sandbox.destroy();`}
          />
          <CodeBlock
            language="bash"
            copyable
            code={`npm install @vercel/sandbox`}
          />
          <ul>
            <li>
              <strong>Full isolation</strong> &mdash; Firecracker micro-VMs
            </li>
            <li>
              <strong>Fast boot</strong> &mdash; sub-second startup
            </li>
            <li>
              <strong>Auto-setup</strong> &mdash; ripgrep installed
              automatically
            </li>
            <li>
              <strong>Best for</strong> &mdash; production deployments,
              untrusted code execution
            </li>
          </ul>
        </section>

        <section>
          <h2 id="e2b-sandbox">E2BSandbox</h2>
          <p>
            Runs on E2B&apos;s hosted infrastructure. Good for serverless
            environments where you can&apos;t run local processes. Requires the{" "}
            <code>@e2b/code-interpreter</code> package and an E2B API key.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import { createE2BSandbox, createAgentTools } from 'bashkit';

// Async — auto-sets up ripgrep
const sandbox = await createE2BSandbox({
  apiKey: process.env.E2B_API_KEY,
});

const { tools } = await createAgentTools(sandbox);

// Reconnect to an existing sandbox
const reconnected = await createE2BSandbox({
  apiKey: process.env.E2B_API_KEY,
  sandboxId: sandbox.id,
});

await sandbox.destroy();`}
          />
          <CodeBlock
            language="bash"
            copyable
            code={`npm install @e2b/code-interpreter`}
          />
          <ul>
            <li>
              <strong>Hosted execution</strong> &mdash; no local processes
              needed
            </li>
            <li>
              <strong>Reconnectable</strong> &mdash; resume sandboxes by ID
            </li>
            <li>
              <strong>Auto-setup</strong> &mdash; ripgrep installed
              automatically
            </li>
            <li>
              <strong>Best for</strong> &mdash; serverless, hosted applications
            </li>
          </ul>
        </section>
      </article>

      <Footer />
    </>
  );
}
