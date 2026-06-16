"use client";

import { CodeBlock } from "../components/CodeBlock";
import { Footer } from "../Footer";

export default function Codemode() {
  return (
    <>
      <article className="article">
        <header>
          <h1>Codemode</h1>
          <p className="tagline">
            Let the model write code that orchestrates BashKit tools in batches.
          </p>
        </header>

        <section>
          <h2 id="overview">Overview</h2>
          <p>
            Codemode wraps selected BashKit tools behind one Cloudflare Codemode
            tool. Instead of asking the model to call <code>Glob</code>, then{" "}
            <code>Grep</code>, then <code>Read</code> one turn at a time, the
            model can write a small JavaScript async arrow function that calls
            those tools with loops, branches, and parallel work.
          </p>
          <p>
            BashKit does not run the code itself. It delegates to Cloudflare
            Codemode&apos;s executor, while the code still calls BashKit&apos;s
            policy-wrapped tools. That means context layers, plan-mode gates,
            output policy, and sandbox restrictions keep applying.
          </p>
        </section>

        <section>
          <h2 id="setup">Setup</h2>
          <p>
            Install Cloudflare Codemode alongside BashKit, then provide an
            executor through <code>codemode</code> config.
          </p>
          <p>
            Cloudflare Codemode currently targets AI SDK v6, so BashKit&apos;s
            codemode adapter follows that path.
          </p>
          <CodeBlock
            language="bash"
            copyable
            code={`npm install @cloudflare/codemode`}
          />
          <CodeBlock
            language="typescript"
            copyable
            code={`import { DynamicWorkerExecutor } from '@cloudflare/codemode';
import { createAgentTools, createPrepareStep } from 'bashkit';
import { streamText } from 'ai';

const { tools, planModeState } = await createAgentTools(sandbox, {
  planMode: true,
  context: {
    executionPolicy: {}, // plan-mode gating with defaults
    outputPolicy: { maxOutputLength: 30_000 },
  },
  codemode: {
    executor: new DynamicWorkerExecutor({ loader: env.LOADER }),
    includeTools: ['Read', 'Glob', 'Grep', 'Bash'],
  },
});

await streamText({
  model,
  tools,
  messages,
  prepareStep: createPrepareStep({ planModeState }),
});`}
          />
        </section>

        <section>
          <h2 id="batched-workflows">Batched Workflows</h2>
          <p>
            Codemode is useful when the model needs to fan out across files,
            combine results, or retry/narrow a search. The generated code can
            batch those steps into one tool call.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`// Example of code the model can write inside codemode:
async () => {
  const files = await bashkit.Glob({
    pattern: 'src/**/*.ts',
    path: null,
  });

  const planModeMatches = await Promise.all(
    files.matches.map((file) =>
      bashkit.Grep({
        pattern: 'PlanMode|planModeState|ExitPlanMode',
        path: file,
        glob: null,
        type: null,
        output_mode: 'content',
        '-i': null,
        '-n': true,
        '-B': null,
        '-A': null,
        '-C': 2,
        head_limit: 20,
        offset: null,
        multiline: null,
      }),
    ),
  );

  const interestingFiles = planModeMatches
    .filter((result) => 'matches' in result && result.matches.length > 0)
    .map((result) => result.matches[0].file);

  const snippets = await Promise.all(
    interestingFiles.slice(0, 5).map((file_path) =>
      bashkit.Read({
        file_path,
        offset: 1,
        limit: 120,
      }),
    ),
  );

  return {
    scanned: files.count,
    matchedFiles: interestingFiles,
    snippets,
  };
};`}
          />
          <p>
            That would normally take many model/tool turns. With Codemode, the
            model can express the workflow as code and return a structured
            result.
          </p>
        </section>

        <section>
          <h2 id="tool-selection">Tool Selection</h2>
          <p>
            Keep the runtime tool set narrow. <code>includeTools</code> is the
            safest default because generated code can loop and fan out calls.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`const { tools } = await createAgentTools(sandbox, {
  codemode: {
    executor,
    includeTools: ['Read', 'Glob', 'Grep'],
    tools: {
      // Optional AI SDK tools exposed only inside codemode
      SummarizeFile,
    },
  },
});`}
          />
          <p>
            BashKit always excludes client-intervention tools from Codemode:
            <code>AskUser</code>, <code>EnterPlanMode</code>,{" "}
            <code>ExitPlanMode</code>, tools without an <code>execute</code>{" "}
            function, and tools with <code>needsApproval</code>.
          </p>
        </section>

        <section>
          <h2 id="namespaces">Namespaces</h2>
          <p>
            The tool exposed to the model is named <code>codemode</code> by
            default. Inside the generated JavaScript, selected BashKit tools are
            exposed under BashKit&apos;s <code>bashkit.*</code> namespace. Tool
            methods keep BashKit&apos;s public tool names, so the grep tool is{" "}
            <code>bashkit.Grep(...)</code>.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`// Direct model tool call:
tools.codemode({
  code: \`async () => {
    const files = await bashkit.Glob({
      pattern: 'src/**/*.ts',
      path: null,
    });

    return files.matches;
  }\`,
});`}
          />
          <p>
            Use <code>providers</code> when you want separate namespaces for
            custom tool groups. Each provider gets its own object inside the
            generated code, which keeps domain-specific helpers easier to scan.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`const { tools } = await createAgentTools(sandbox, {
  codemode: {
    executor,
    includeTools: ['Read', 'Glob', 'Grep'],
    providers: [
      {
        name: 'github',
        tools: {
          ListIssues,
          FetchPullRequest,
        },
      },
    ],
  },
});

// Generated code can do this in one codemode call:
async () => {
  const todos = await bashkit.Grep({
    pattern: 'TODO|FIXME',
    path: 'src',
    glob: '*.ts',
    type: null,
    output_mode: 'content',
    '-i': null,
    '-n': true,
    '-B': null,
    '-A': null,
    '-C': 2,
    head_limit: 20,
    offset: null,
    multiline: null,
  });

  const issues = await github.ListIssues({
    labels: ['tech-debt'],
    state: 'open',
  });

  return { todos, issues };
};`}
          />
          <p>
            Executable-only and <code>needsApproval</code> filtering applies to
            every namespace. Top-level <code>includeTools</code> narrows the
            default <code>bashkit.*</code> namespace; providers can define their
            own <code>includeTools</code> or <code>excludeTools</code>.
          </p>
        </section>

        <section>
          <h2 id="policy">Policy</h2>
          <p>
            Codemode receives the same wrapped tools that normal model tool
            calls receive. If plan mode is active, <code>Bash</code>,{" "}
            <code>Write</code>, and <code>Edit</code> are still blocked by the
            execution policy even when generated code calls them.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`const { tools, planModeState } = await createAgentTools(sandbox, {
  planMode: true,
  context: {
    executionPolicy: {
      planModeBlockedTools: ['Bash', 'Write', 'Edit'],
    },
  },
  codemode: {
    executor,
    includeTools: ['Read', 'Glob', 'Grep', 'Bash'],
  },
});

if (planModeState) {
  planModeState.isActive = true;
}

// A codemode-generated call to bashkit.Bash(...) returns the same
// "Bash is not available in plan mode" error as a direct Bash tool call.`}
          />
        </section>
      </article>

      <Footer />
    </>
  );
}
