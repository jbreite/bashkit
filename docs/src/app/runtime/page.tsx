"use client";

import { CodeBlock } from "../components/CodeBlock";
import { Footer } from "../Footer";

export default function Runtime() {
  return (
    <>
      <article className="article">
        <header>
          <h1>Runtime</h1>
          <p className="tagline">
            Host-facing events, plan state, approvals, and snapshots for
            Codex-style interfaces.
          </p>
        </header>

        <section>
          <h2 id="overview">Overview</h2>
          <p>
            Runtime APIs are not tools the model calls. They are the typed state
            and event layer that host apps can observe while BashKit tools,
            Codemode, plans, approvals, and subagents run.
          </p>
          <p>
            This keeps BashKit useful for building a Codex-like UI without
            making BashKit own your app server, database, websocket layer,
            terminal UI, or persistence model.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import {
  createAgentTools,
  createMemoryRuntimeEventSink,
  projectProgressSnapshot,
} from 'bashkit';

const eventSink = createMemoryRuntimeEventSink();

const { tools, planState, getSubagentControlPanelState } =
  await createAgentTools(sandbox, {
    runtime: {
      eventSink,
      planContext: {
        agent_id: 'main',
        thread_id: 'thread_123',
        turn_id: 'turn_456',
      },
    },
    subagents: {
      model,
    },
  });

eventSink.subscribe((event) => {
  sendToClient(event);
});

const progress = projectProgressSnapshot(eventSink.events);
const subagents = await getSubagentControlPanelState?.();`}
          />
        </section>

        <section>
          <h2 id="event-sink">Event Sink</h2>
          <p>
            A <code>RuntimeEventSink</code> receives normalized runtime events.
            The built-in memory sink is useful for tests, demos, and host-side
            projection. Production hosts usually forward events to their own
            stream, log, or persistence layer.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import {
  createMemoryRuntimeEventSink,
  emitRuntimeEvent,
  createRuntimeEvent,
} from 'bashkit';

const sink = createMemoryRuntimeEventSink();

const unsubscribe = sink.subscribe((event) => {
  console.log(event.type, event.timestamp);
});

await emitRuntimeEvent(
  sink,
  createRuntimeEvent({
    type: 'command.output',
    stream: 'stdout',
    chunk: 'install complete\\n',
    agent_id: 'main',
    thread_id: 'thread_123',
    turn_id: 'turn_456',
  }),
);

unsubscribe();`}
          />
          <p>
            Common event families include <code>tool.started</code>,{" "}
            <code>tool.completed</code>, <code>tool.failed</code>,{" "}
            <code>plan.updated</code>, <code>approval.requested</code>,{" "}
            <code>approval.resolved</code>, <code>file.changed</code>,{" "}
            <code>command.output</code>, <code>agent.started</code>, and{" "}
            <code>agent.completed</code>.
          </p>
        </section>

        <section>
          <h2 id="plan-state">Plan State</h2>
          <p>
            <code>UpdatePlan</code> writes to a canonical plan state. Hosts can
            initialize the plan, observe <code>plan.updated</code> events, and
            project the latest plan into a progress panel.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`const { tools, planState } = await createAgentTools(sandbox, {
  runtime: {
    initialPlan: {
      plan: [
        { step: 'Inspect docs', status: 'completed' },
        { step: 'Add runtime page', status: 'in_progress' },
      ],
    },
  },
});

console.log(planState.snapshot());
console.log(planState.stats());`}
          />
        </section>

        <section>
          <h2 id="ai-sdk-ui-streams">AI SDK UI Streams</h2>
          <p>
            Runtime events stay outside the model message list by default, but
            hosts can forward them to the browser as AI SDK UI data parts. The
            model still receives ordinary tool results; the UI receives typed
            progress, changes, approvals, and subagent activity alongside the
            assistant stream.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from 'ai';
import {
  createAgentTools,
  createMemoryRuntimeEventSink,
  type RuntimeEvent,
} from 'bashkit';

type AgentMessage = UIMessage<
  unknown,
  { 'bashkit-runtime-event': RuntimeEvent }
>;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const stream = createUIMessageStream<AgentMessage>({
    execute: async ({ writer }) => {
      const eventSink = createMemoryRuntimeEventSink();

      eventSink.subscribe((event) => {
        writer.write({
          type: 'data-bashkit-runtime-event',
          data: event,
          transient: true,
        });

        // Optional: also persist for refresh-safe UI state.
        persistRuntimeEvent(event);
      });

      const { tools } = await createAgentTools(sandbox, {
        runtime: { eventSink },
      });

      const result = streamText({
        model,
        messages,
        tools,
      });

      writer.merge(result.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
}`}
          />
        </section>

        <section>
          <h2 id="file-changes">File Changes</h2>
          <p>
            When a runtime <code>eventSink</code> is configured, BashKit emits{" "}
            <code>file.changed</code> events after successful calls to{" "}
            <code>Bash</code>, <code>Write</code>, <code>Edit</code>, and{" "}
            <code>Patch</code>. Each event includes the path, change type,
            originating tool, tool call id, and a unified diff when BashKit can
            safely capture one. Bash changes are detected by snapshotting
            watched roots before and after the command.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`const eventSink = createMemoryRuntimeEventSink();

const { tools } = await createAgentTools(sandbox, {
  patch: true,
  runtime: {
    eventSink,
    fileChanges: {
      rootPaths: ['/workspace'],
      maxSnapshotFiles: 1_000,
      maxSnapshotDepth: 8,
      maxDiffBytes: 80_000,
    },
  },
});

eventSink.subscribe((event) => {
  if (event.type === 'file.changed') {
    console.log(event.path, event.change, event.unified_diff);
  }
});

// Set fileChanges: false to disable automatic change events.`}
          />
        </section>

        <section>
          <h2 id="approvals">Approvals</h2>
          <p>
            BashKit exposes approval event helpers so hosts can render and audit
            approval flows consistently. A denied tool call denies that specific
            execution, not the whole tool forever.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import {
  createApprovalRequest,
  createApprovalResult,
  createApprovalRequestedEvent,
  createApprovalResolvedEvent,
} from 'bashkit';

const approval = createApprovalRequest({
  subject: {
    type: 'tool',
    tool_name: 'Bash',
    input: { command: 'npm install' },
  },
  reason: 'Install project dependencies',
  agentId: 'main',
});

await eventSink.emit(createApprovalRequestedEvent(approval));

const result = createApprovalResult({
  approvalId: approval.approval_id,
  decision: 'approved',
});

await eventSink.emit(createApprovalResolvedEvent(approval, result));`}
          />
        </section>

        <section>
          <h2 id="snapshots">Snapshots</h2>
          <p>
            Snapshot helpers turn event history into host-facing state. They are
            deliberately plain JSON so a server can send them to any UI
            framework.
          </p>
          <CodeBlock
            language="typescript"
            copyable
            code={`import {
  projectPlanSnapshot,
  projectAgentActivitySnapshot,
  projectChangesSnapshot,
  projectProgressSnapshot,
} from 'bashkit';

const plan = projectPlanSnapshot(eventSink.events);
const agents = projectAgentActivitySnapshot(eventSink.events);
const changes = projectChangesSnapshot(eventSink.events);

const progress = projectProgressSnapshot(eventSink.events);

return Response.json({
  plan,
  agents,
  changes,
  progress,
});`}
          />
        </section>

        <section>
          <h2 id="host-responsibilities">Host Responsibilities</h2>
          <p>
            BashKit emits events and maintains typed runtime primitives. The
            host still owns the outer product concerns:
          </p>
          <ul>
            <li>
              Persisting event history, transcripts, and result references
            </li>
            <li>Streaming runtime events to browsers or desktop views</li>
            <li>Rendering progress, changes, approvals, and subagent panels</li>
            <li>Mapping approval decisions back to AI SDK tool execution</li>
            <li>Choosing cancellation, auth, retention, and audit policies</li>
          </ul>
        </section>
      </article>

      <Footer />
    </>
  );
}
