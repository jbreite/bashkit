# Plan: Cloudflare Agent Architecture for bashkit

This plan outlines how to implement a Ramp-style background agent architecture using bashkit, Cloudflare Durable Objects, and Vercel/E2B sandboxes.

## Overview

**Goal**: Move the agent execution into the sandbox (like Ramp's OpenCode), with Cloudflare Durable Objects as the coordination/state layer, enabling:
- Pre-warmed sandbox pools for fast startup
- Persistent session state (survives deploys)
- Multiplayer support
- Multiple client interfaces (web, Slack, etc.)

**Current State** (sql-chatbot):
- Agent runs in Next.js API route on Vercel
- Tools call out to Vercel Sandbox over network (latency on every tool call)
- Session state stored in ephemeral Map (lost on redeploy)
- Single client (web)

**Target State**:
- Agent runs inside the sandbox with bashkit (tools execute locally, no network latency)
- Cloudflare DO is a thin relay + state persistence layer
- Sandbox pool provides instant startup
- Any client can connect through the DO

---

## Architecture

**Key insight**: The agent loop (`streamText`) runs IN the sandbox. Tools execute locally. The DO just relays and persists state.

```
┌──────────────┐     ┌─────────────────────────┐     ┌─────────────────────────────────┐
│              │     │  Cloudflare DO          │     │  Sandbox                        │
│   Client     │◄───►│  (relay + state)        │◄───►│  (runs the agent)               │
│   (Next.js)  │ WS  │                         │ WS  │                                 │
│              │     │  - Claim sandbox        │     │  streamText() runs HERE         │
│  useAgentChat│     │  - Hydrate sandbox      │     │  bashkit tools execute HERE     │
│              │     │  - Relay streams        │     │  Streams AI SDK format back     │
│              │     │  - Persist to SQLite    │     │                                 │
└──────────────┘     └─────────────────────────┘     └─────────────────────────────────┘
                                │
                                │ On session start
                                ▼
                     ┌─────────────────────────┐
                     │  Sandbox Pool           │
                     │  (pre-warmed)           │
                     │                         │
                     │  - bashkit installed    │
                     │  - Ready to claim       │
                     └─────────────────────────┘
```

**Data flow for a prompt:**
1. Client sends prompt via `useAgentChat` → DO
2. DO forwards prompt to Sandbox
3. Sandbox runs `streamText` with bashkit tools (locally, no network hops)
4. Sandbox streams AI SDK UI message format back to DO
5. DO relays stream to Client (and persists messages to SQLite)

**Why this is better than current architecture:**
- Tools execute locally in sandbox (no network latency per tool call)
- DO handles persistence + reconnection (survives deploys)
- Pre-warmed sandboxes = fast startup
- Same sandbox can handle multiple prompts in a conversation

---

## Components to Build

### 1. bashkit/serve (New Module)

**Location**: `bashkit/src/serve/`

**Purpose**: Thin WebSocket server that runs inside the sandbox. User controls the `streamText` call - bashkit just provides the server infrastructure and stream piping.

**Design principle**: Don't hide `streamText`. The user writes their own agent loop, bashkit just handles the WebSocket plumbing.

**API**:
```typescript
import { createAgentServer } from 'bashkit/serve';
import { createLocalSandbox, createAgentTools } from 'bashkit';
import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const sandbox = createLocalSandbox({ cwd: '/workspace' });
const { tools } = createAgentTools(sandbox, { cache: true });

let systemPrompt = '';
let messages: Message[] = [];

const server = createAgentServer({ port: 8080 });

server.on('hydrate', async (context, ws) => {
  // User handles hydration however they want
  await Bun.write('/workspace/.context/data.json', JSON.stringify(context));
  systemPrompt = generateSystemPrompt(context);
  ws.send({ type: 'ready' });
});

server.on('prompt', async (prompt, ws) => {
  messages.push({ role: 'user', content: prompt.content });

  // User controls the streamText call entirely
  const result = streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: systemPrompt,
    messages,
    tools,
    maxSteps: 30,
    onFinish: ({ response }) => {
      messages = response.messages; // Update conversation history
    },
  });

  // bashkit pipes the AI SDK stream to WebSocket
  await server.streamResponse(result, ws);
});

server.listen();
```

**What bashkit/serve provides**:
1. `createAgentServer({ port })` - WebSocket server with typed events
2. `server.on('hydrate', handler)` - Receive hydration context from DO
3. `server.on('prompt', handler)` - Receive prompts from DO
4. `server.streamResponse(result, ws)` - Pipe `streamText` result to WebSocket in AI SDK UI format

**What bashkit/serve does NOT do**:
- Does not call `streamText` for you
- Does not manage conversation history for you
- Does not define your system prompt
- Does not configure tools for you

**Message Protocol**:
```typescript
// DO → Sandbox
type IncomingMessage =
  | { type: 'hydrate'; context: unknown }
  | { type: 'prompt'; content: string; attachments?: Attachment[] }
  | { type: 'cancel' }
  | { type: 'ping' };

// Sandbox → DO
type OutgoingMessage =
  | { type: 'ready' }
  | { type: 'stream-start' }
  | { type: 'stream-chunk'; chunk: string }  // AI SDK data stream format
  | { type: 'stream-end' }
  | { type: 'error'; message: string }
  | { type: 'pong' };
```

**Files**:
```
bashkit/src/serve/
├── index.ts           # Main export
├── server.ts          # WebSocket server with typed events
├── protocol.ts        # Message types and Zod validation
└── stream-pipe.ts     # Pipes AI SDK streamText to WebSocket
```

---

### 2. Cloudflare Worker + Durable Object

**Location**: New package or in sql-chatbot repo under `workers/`

**Purpose**: Thin relay layer that manages sandbox lifecycle, relays messages, and persists state. Does NOT run the agent loop.

**Key principle**: The DO is a "dumb pipe" with persistence. All AI logic happens in the sandbox.

**Structure**:
```
workers/chat-agent/
├── wrangler.toml
├── src/
│   ├── index.ts              # Worker entry, routes to DO
│   ├── chat-session.ts       # Durable Object implementation
│   ├── sandbox-pool.ts       # Pool management
│   └── types.ts
└── package.json
```

**Durable Object Implementation**:
```typescript
// chat-session.ts
import { Agent } from 'agents';

interface Env {
  SANDBOX_API_KEY: string;
  CONTEXT_API_URL: string;
  CONTEXT_API_KEY: string;
}

export class ChatSession extends Agent<Env> {
  private sandboxWs: WebSocket | null = null;

  async onStart() {
    // Setup SQLite tables for persistence
    this.sql`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        parts TEXT,  -- JSON for AI SDK message parts
        created_at INTEGER NOT NULL
      )
    `;

    this.sql`
      CREATE TABLE IF NOT EXISTS session_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `;
  }

  // Called when client connects
  async onConnect(conn: Connection, ctx: ConnectionContext) {
    const url = new URL(ctx.request.url);
    const surveyRequestId = url.searchParams.get('surveyRequestId');
    const userId = url.searchParams.get('userId');
    const orgId = url.searchParams.get('orgId');

    // Check if we have an active sandbox
    const existingSandboxId = this.getMeta('sandboxId');

    if (existingSandboxId && this.sandboxWs?.readyState === WebSocket.OPEN) {
      // Already connected to sandbox, just relay
      conn.send(JSON.stringify({ type: 'ready' }));
    } else if (existingSandboxId) {
      // Have sandbox ID but not connected, reconnect
      await this.reconnectToSandbox(existingSandboxId);
    } else {
      // New session, initialize
      await this.initializeSession(surveyRequestId!, userId!, orgId!);
    }
  }

  async initializeSession(surveyRequestId: string, userId: string, orgId: string) {
    // 1. Claim sandbox from pool (pre-warmed, bashkit already installed)
    const sandbox = await this.claimSandbox();

    // 2. Fetch survey context from Next.js API
    const context = await fetch(
      `${this.env.CONTEXT_API_URL}/api/internal/survey-context/${surveyRequestId}`,
      { headers: { Authorization: `Bearer ${this.env.CONTEXT_API_KEY}` } }
    ).then(r => r.json());

    // 3. Connect to sandbox's bashkit server
    this.sandboxWs = new WebSocket(`wss://${sandbox.host}:8080`);

    // 4. Send hydration context to sandbox
    this.sandboxWs.onopen = () => {
      this.sandboxWs!.send(JSON.stringify({ type: 'hydrate', context }));
    };

    // 5. Setup relay (sandbox ↔ clients)
    this.setupRelay();

    // 6. Persist sandbox info
    this.setMeta('sandboxId', sandbox.id);
    this.setMeta('sandboxHost', sandbox.host);
    this.setMeta('surveyRequestId', surveyRequestId);
  }

  setupRelay() {
    // Sandbox → All connected clients
    this.sandboxWs!.onmessage = (event) => {
      const data = event.data;

      // Relay to all clients (DO handles fan-out)
      for (const conn of this.getConnections()) {
        conn.send(data);
      }

      // Optionally persist completed messages to SQLite
      // (parsed from AI SDK stream format)
    };

    this.sandboxWs!.onerror = (error) => {
      console.error('Sandbox WebSocket error:', error);
    };

    this.sandboxWs!.onclose = () => {
      console.log('Sandbox WebSocket closed');
    };
  }

  // Client sends a message (prompt)
  async onMessage(conn: Connection, message: WSMessage) {
    // Just forward to sandbox - the sandbox handles everything
    this.sandboxWs?.send(message);
  }

  // Cleanup on all clients disconnect
  async onClose(conn: Connection, code: number, reason: string) {
    const connections = this.getConnections();

    if (connections.length === 0) {
      // No more clients, schedule sandbox release
      // Keep alive for X minutes for reconnection
      await this.schedule(
        Date.now() + 10 * 60 * 1000, // 10 minutes
        'releaseSandbox',
        {}
      );
    }
  }

  async releaseSandbox() {
    // Only release if still no connections
    if (this.getConnections().length === 0) {
      this.sandboxWs?.close();
      await this.releaseSandboxToPool(this.getMeta('sandboxId'));
      this.setMeta('sandboxId', null);
    }
  }

  // Helpers
  private getMeta(key: string): string | null {
    const rows = this.sql<{ value: string }>`
      SELECT value FROM session_meta WHERE key = ${key}
    `;
    return rows[0]?.value ?? null;
  }

  private setMeta(key: string, value: string | null) {
    if (value === null) {
      this.sql`DELETE FROM session_meta WHERE key = ${key}`;
    } else {
      this.sql`
        INSERT INTO session_meta (key, value) VALUES (${key}, ${value})
        ON CONFLICT(key) DO UPDATE SET value = ${value}
      `;
    }
  }
}
```

**What the DO does**:
- Manages sandbox lifecycle (claim, hydrate, release)
- Relays messages between clients and sandbox
- Persists conversation state to SQLite
- Handles reconnection (same sandbox for returning users)
- Handles multiplayer (multiple clients → same sandbox)

**What the DO does NOT do**:
- Does not run `streamText`
- Does not call AI models
- Does not execute tools
- Does not manage conversation history (sandbox does that)

---

### 3. Sandbox Pool Manager

**Purpose**: Maintains a pool of pre-warmed sandboxes ready for instant claim.

**Options**:

#### Option A: Cloudflare DO Pool Manager
A separate Durable Object that manages the pool:
```typescript
export class SandboxPool extends DurableObject {
  private warmSandboxes: SandboxInfo[] = [];
  private targetPoolSize = 10;

  async claim(): Promise<SandboxInfo> {
    if (this.warmSandboxes.length > 0) {
      const sandbox = this.warmSandboxes.pop()!;
      this.scheduleReplenish();
      return sandbox;
    }
    // Cold start fallback
    return this.createSandbox();
  }

  async release(sandboxId: string) {
    // Destroy or recycle
  }

  private async scheduleReplenish() {
    // Maintain target pool size
  }
}
```

#### Option B: External Pool Service
A separate service (could be on Vercel) that:
- Maintains warm sandboxes via cron
- Exposes claim/release API
- Handles sandbox lifecycle

#### Option C: Vercel/E2B Native Pooling
If the sandbox provider supports pooling natively, use that.

**Recommendation**: Start with Option A (Cloudflare DO), migrate to provider-native if available.

---

### 4. Next.js Changes

#### 4.1 Internal API Endpoint

**Location**: `sql-chatbot/app/api/internal/survey-context/[id]/route.ts`

**Purpose**: Provides survey context for sandbox hydration. Called by Cloudflare DO.

```typescript
import { auth } from '@clerk/nextjs/server';
import { generateStudyChatContext } from '@/lib/services/survey-requests/chat/context';

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  // Verify internal API key
  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id } = await params;
  const orgId = req.headers.get('X-Org-Id');

  const context = await generateStudyChatContext(id, orgId || undefined);

  return Response.json(context);
}
```

#### 4.2 Frontend Changes

**Current**: Calls `/api/survey-requests/[id]/chat` directly
**New**: Uses `useAgentChat` from bashkit/react

```typescript
// Before
const { messages, input, handleSubmit } = useChat({
  api: `/api/survey-requests/${surveyRequestId}/chat`,
  body: { conversationId, planMode },
});

// After
import { useAgentChat } from 'bashkit/react';

const agent = useAgent({
  agent: 'chat-session',
  name: conversationId,  // DO instance name
  params: { surveyRequestId, userId, orgId },
});

const { messages, input, handleSubmit } = useAgentChat({ agent });
```

#### 4.3 Remove Old Route

Delete or deprecate: `app/api/survey-requests/[id]/chat/route.ts`

---

### 5. Sandbox Image

**Purpose**: Pre-built image with bashkit installed, ready to serve.

**For Vercel Sandbox**:
```dockerfile
# Base image with Node/Bun
FROM node:22-slim

# Install bashkit globally
RUN npm install -g bashkit

# Or install in workspace
WORKDIR /workspace
RUN npm init -y && npm install bashkit @ai-sdk/anthropic ai

# Startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
```

**start.sh**:
```bash
#!/bin/bash
# Wait for hydration, then start serving
bashkit serve --port 8080 --workspace /workspace
```

**For E2B**: Use their template system with similar setup.

---

## Implementation Phases

### Phase 1: bashkit/serve Core
**Goal**: Working WebSocket server that runs in sandbox

**Tasks**:
1. Create `bashkit/src/serve/` directory structure
2. Implement WebSocket server with Bun.serve or ws
3. Define message protocol (hydrate, prompt, stream, etc.)
4. Implement hydration handler (write files to filesystem)
5. Integrate with streamText, stream AI SDK format back
6. Add reconnection/resume support
7. Write tests
8. Export from `bashkit/serve`

**Deliverable**: Can run `bashkit serve --port 8080` in sandbox, connect via WebSocket, send prompts, receive streamed responses.

---

### Phase 2: Cloudflare Worker + DO
**Goal**: Coordination layer that manages sandbox lifecycle

**Tasks**:
1. Create new worker package (`workers/chat-agent/`)
2. Implement ChatSession Durable Object
3. Implement sandbox claim/connect logic
4. Implement hydration flow (fetch context, send to sandbox)
5. Implement client ↔ sandbox relay
6. Add SQLite persistence for messages
7. Handle reconnection (existing sandbox)
8. Deploy to Cloudflare

**Deliverable**: Client can connect to DO via WebSocket, DO manages sandbox, relays messages.

---

### Phase 3: Sandbox Pool
**Goal**: Pre-warmed sandboxes for instant startup

**Tasks**:
1. Implement SandboxPool DO (or service)
2. Add claim/release API
3. Implement pool replenishment logic
4. Add monitoring/metrics
5. Configure target pool size per environment

**Deliverable**: Warm sandboxes available, claim takes <1s.

---

### Phase 4: sql-chatbot Integration
**Goal**: Replace existing chat route with new architecture

**Tasks**:
1. Add internal API endpoint for survey context
2. Update frontend to use `useAgentChat`
3. Update conversation service for new message format
4. Handle artifact persistence (from DO or sandbox events)
5. Migrate existing conversations (if needed)
6. Remove old chat route
7. Update environment variables

**Deliverable**: Survey chat works end-to-end with new architecture.

---

### Phase 5: Production Hardening
**Goal**: Ready for production traffic

**Tasks**:
1. Add comprehensive error handling
2. Implement sandbox timeout/cleanup
3. Add rate limiting
4. Add authentication/authorization
5. Add observability (logs, metrics, tracing)
6. Load testing
7. Documentation

**Deliverable**: Production-ready system.

---

## Open Questions

### Q1: Sandbox Provider
- **Vercel Sandbox**: Already using, good integration, but pooling support?
- **E2B**: Better pooling, but different provider
- **Modal**: What Ramp uses, excellent snapshotting

**Recommendation**: Start with current provider (Vercel), evaluate Modal for pooling.

### Q2: Where to Deploy Cloudflare Worker
- Same repo as sql-chatbot (monorepo)?
- Separate repo?
- In bashkit repo as example?

**Recommendation**: Start in sql-chatbot under `workers/`, can extract later.

### Q3: Artifact Persistence
- Current: Vercel Blob
- New: Cloudflare R2? Still Vercel Blob?
- Who uploads: Sandbox or DO?

**Recommendation**: Sandbox notifies DO of artifacts, DO uploads to storage.

### Q4: Chat History
- Current: PostgreSQL (sql-chatbot DB)
- New: DO SQLite + sync to Postgres?

**Recommendation**: Primary in DO SQLite for speed, async sync to Postgres for querying.

### Q5: Authentication
- How does client authenticate to Cloudflare Worker?
- Pass Clerk token? JWT?

**Recommendation**: Client sends Clerk JWT, Worker validates with Clerk.

---

## Dependencies

### bashkit
- `ws` or use Bun.serve for WebSocket server
- Existing: ai, zod, sandbox providers

### Cloudflare Worker
- `agents` (Cloudflare Agents SDK)
- `hono` (optional, for HTTP routing)

### sql-chatbot
- `bashkit` (updated with /serve)
- `bashkit/react` for useAgentChat

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Sandbox cold start latency | Bad UX | Pool pre-warming |
| WebSocket disconnects | Lost messages | Reconnection + message persistence |
| Sandbox provider outage | Complete outage | Multi-provider support in bashkit |
| Cost of idle sandboxes | $$$$ | Aggressive timeout + release |
| Complexity increase | Maintenance burden | Good abstractions, documentation |

---

## Success Metrics

1. **Time to first token**: <2s (with warm sandbox)
2. **Session reconnection**: Works after deploy
3. **Sandbox utilization**: >80% of claimed sandboxes used
4. **Error rate**: <0.1% of sessions
5. **Cost per session**: Track and optimize

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: bashkit/serve | 3-5 days | None |
| Phase 2: Cloudflare DO | 3-5 days | Phase 1 |
| Phase 3: Sandbox Pool | 2-3 days | Phase 2 |
| Phase 4: Integration | 2-3 days | Phase 3 |
| Phase 5: Hardening | 3-5 days | Phase 4 |

**Total**: ~2-3 weeks for full implementation

---

## Next Steps

1. Review and refine this plan
2. Decide on open questions (sandbox provider, repo structure, etc.)
3. Start Phase 1: bashkit/serve implementation
