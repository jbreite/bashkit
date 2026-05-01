"use client";

import { CodeBlock } from "../components/CodeBlock";
import { Footer } from "../Footer";

export default function Tools() {
  return (
    <>
      <article className="article">
        <header>
          <h1>Tools</h1>
          <p className="tagline">
            All 10 tools available in bashkit, with descriptions and usage
            examples.
          </p>
        </header>

        <section>
          <h2 id="bash">Bash</h2>
          <p>
            Execute shell commands with configurable timeouts. Returns stdout,
            stderr, and exit code.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`// Tool input schema
{
  command: string,       // The command to execute
  description: string,   // What this command does
  timeout: number | null // Timeout in ms (default: 120000)
}

// Example output
{
  stdout: "Hello, world!\\n",
  stderr: "",
  exit_code: 0
}`}
          />
          <p>Configure blocked commands and timeouts:</p>
          <CodeBlock
            language="typescript"
            copyable
            code={`const { tools } = await createAgentTools(sandbox, {
  tools: {
    Bash: {
      timeout: 10000,
      blockedCommands: ['rm -rf', 'dd if=', 'curl'],
    },
  },
});`}
          />
        </section>

        <section>
          <h2 id="read">Read</h2>
          <p>
            Read file contents or list directory entries. Supports line offset
            and limit for large files.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`// Tool input schema
{
  file_path: string,    // Absolute path to read
  offset: number | null, // Start line (1-based)
  limit: number | null   // Max lines to return
}

// File output
{
  content: "line 1\\nline 2\\n...",
  line_count: 42
}

// Directory output (when path is a directory)
{
  entries: ["src/", "package.json", "README.md"],
  entry_count: 3
}`}
          />
        </section>

        <section>
          <h2 id="write">Write</h2>
          <p>
            Create or overwrite files. Creates parent directories automatically.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`// Tool input schema
{
  file_path: string,  // Absolute path to write
  content: string     // Full file content
}

// Output
{
  path: "/path/to/file.ts",
  bytes_written: 1234
}`}
          />
        </section>

        <section>
          <h2 id="edit">Edit</h2>
          <p>
            Replace specific strings in existing files. Supports single or
            multi-occurrence replacement.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`// Tool input schema
{
  file_path: string,        // Absolute path to edit
  old_string: string,       // String to find
  new_string: string,       // Replacement string
  replace_all: boolean | null // Replace all occurrences (default: false)
}

// Output
{
  path: "/path/to/file.ts",
  replacements: 1
}`}
          />
        </section>

        <section>
          <h2 id="glob">Glob</h2>
          <p>
            Find files by glob pattern. Uses fast pattern matching that works
            with any codebase size.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`// Tool input schema
{
  pattern: string,    // Glob pattern (e.g. "**/*.ts")
  path: string | null // Base directory (default: working dir)
}

// Output
{
  files: [
    "src/index.ts",
    "src/tools/bash.ts",
    "src/tools/read.ts"
  ],
  count: 3
}`}
          />
        </section>

        <section>
          <h2 id="grep">Grep</h2>
          <p>
            Search file contents with regex. Uses <code>ripgrep</code> under the
            hood for fast results. Returns matching lines with surrounding
            context.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`// Tool input schema
{
  pattern: string,     // Regex pattern to search
  path: string | null, // Directory to search in
  include: string | null // File pattern filter (e.g. "*.ts")
}

// Output
{
  matches: [
    {
      file: "src/tools/bash.ts",
      line: 42,
      content: "  const timeout = config?.timeout ?? 120000;",
      context_before: ["  // Default timeout"],
      context_after: ["  const maxOutput = config?.maxOutput ?? 30000;"]
    }
  ],
  count: 1
}`}
          />
        </section>

        <section>
          <h2 id="websearch">WebSearch</h2>
          <p>
            Search the web with optional domain filtering. Requires the{" "}
            <code>parallel-web</code> package and a Parallel API key.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`// Tool input schema
{
  query: string,           // Search query
  domains: string[] | null // Limit to specific domains
}

// Output
{
  results: [
    {
      title: "Vercel AI SDK Documentation",
      url: "https://sdk.vercel.ai/docs",
      snippet: "The Vercel AI SDK is a TypeScript toolkit..."
    }
  ]
}`}
          />
          <p>
            Enabled by passing <code>webSearch</code> config:
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`const { tools } = await createAgentTools(sandbox, {
  webSearch: { apiKey: process.env.PARALLEL_API_KEY },
});`}
          />
        </section>

        <section>
          <h2 id="webfetch">WebFetch</h2>
          <p>
            Fetch and extract content from URLs. Returns cleaned text content
            from web pages.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`// Tool input schema
{
  url: string,           // URL to fetch
  format: string | null  // "text" | "markdown" | "html"
}

// Output
{
  content: "Page content extracted as clean text...",
  title: "Page Title",
  url: "https://example.com/page"
}`}
          />
        </section>

        <section>
          <h2 id="task">Task</h2>
          <p>
            Spawn sub-agents for complex, multi-step work. Each sub-agent gets
            its own tool set and conversation context. When budget tracking is
            enabled, costs are shared across parent and child agents.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`// Tool input schema
{
  description: string,  // Short task description
  prompt: string        // Detailed instructions for the sub-agent
}

// The sub-agent runs autonomously and returns its result
// Budget tracking auto-wires into sub-agents when configured`}
          />
        </section>

        <section>
          <h2 id="todowrite">TodoWrite</h2>
          <p>
            Manage structured task lists. Useful for agents that need to track
            multi-step workflows.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`// Tool input schema
{
  todos: [
    {
      id: string,
      content: string,
      status: "pending" | "in_progress" | "done",
      priority: "high" | "medium" | "low"
    }
  ]
}

// Output
{
  todos: [...], // Updated todo list
  count: 5
}`}
          />
        </section>
      </article>

      <Footer />
    </>
  );
}
