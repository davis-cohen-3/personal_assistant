# Backend

## Overview

Hono server in `src/server/`. Two interaction paths:

1. **Agent path** — WebSocket chat, LLM-powered classification/triage/drafting via Agent SDK + MCP tools
2. **Direct UI path** — REST endpoints for user-initiated actions (open thread, reply, edit event) that bypass the agent

Both paths share the same `google/*` connectors, `email.ts` orchestration layer, and `db/` layer. Google OAuth for login + API access, with email allowlist.

---

## Error Handling

### `src/server/exceptions.ts`

Custom error class used throughout the backend. Carries an HTTP status code so the central error handler can map it to a response without inspecting the message.

```typescript
// src/server/exceptions.ts

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}
```

**Usage in connectors, queries, and tools:**

```typescript
// Wrap external errors with context
throw new AppError('Failed to fetch Gmail thread', 502, { cause: err });

// Domain errors with appropriate status
throw new AppError('Bucket not found', 404);
throw new AppError('Missing required field: name', 400);
```

### Central Error Handler (`app.onError`)

All unhandled errors from routes, middleware, and tools land here. Handles three cases: `ZodError` from body validation (400), known `AppError`s (status from error), and unexpected errors (500). Logs full details server-side, returns a safe response to the client.

```typescript
// In src/server/index.ts
import { ZodError } from 'zod';
import { AppError } from './exceptions';


app.onError((err, c) => {
  if (err instanceof ZodError) {
    console.warn('Validation failed', { issues: err.issues });
    return c.json({ error: 'Validation failed', issues: err.issues }, 400);
  }

  if (err instanceof AppError) {
    console.error(err.message, { status: err.status, cause: err.cause });
    return c.json({ error: err.message }, err.status);
  }

  console.error('Unhandled error', { error: err });
  return c.json({ error: 'Internal server error' }, 500);
});
```

Routes stay thin — they do NOT catch errors. `endpoint()` doesn't catch errors either. Everything propagates to `onError`.

---

## Hono Server Setup

```typescript
// src/server/index.ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { serveStatic } from '@hono/node-server/serve-static';
import { authMiddleware, googleAuthRoutes } from './auth';
import { handleWebSocket } from './agent';
import { ZodError } from 'zod';
import { AppError } from './exceptions';


// Validate required env vars at startup — fail fast with clear error
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'ALLOWED_USERS', 'ANTHROPIC_API_KEY', 'ENCRYPTION_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Central error handler — catches all unhandled errors
app.onError((err, c) => {
  if (err instanceof ZodError) {
    console.warn('Validation failed', { issues: err.issues });
    return c.json({ error: 'Validation failed', issues: err.issues }, 400);
  }
  if (err instanceof AppError) {
    console.error(err.message, { status: err.status, cause: err.cause });
    return c.json({ error: err.message }, err.status);
  }
  console.error('Unhandled error', { error: err });
  return c.json({ error: 'Internal server error' }, 500);
});

// Security headers
app.use('*', async (c, next) => {
  await next();
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:; img-src 'self' data:; frame-src 'none'; object-src 'none'");
});

// Health check — before auth so Railway can probe it
app.get('/health', async (c) => {
  await db.execute(sql`SELECT 1`);
  return c.json({ status: 'ok' });
});

// Public routes — Google OAuth login
app.route('/auth', googleAuthRoutes);

// Static file serving — before auth so the SPA (login page, JS bundles) can load unauthenticated
// Serves /assets/* from dist/client/assets/, all other non-API/WS paths serve index.html (SPA catch-all)
app.get('/assets/*', serveStatic({ root: './dist/client' }));
app.get('*', async (c, next) => {
  // Skip SPA catch-all for API and WebSocket routes — let them fall through to auth + handlers
  const path = c.req.path;
  if (path.startsWith('/api') || path.startsWith('/ws') || path.startsWith('/auth')) {
    return next();
  }
  // If the path looks like a static file (has extension), try serving it from dist/client
  if (path.includes('.')) {
    return serveStatic({ root: './dist/client' })(c, async () => {
      return c.notFound();
    });
  }
  // SPA catch-all: serve index.html for client-side routing
  return serveStatic({ root: './dist/client', path: '/index.html' })(c, async () => {
    return c.notFound();
  });
});

// Protected routes — require valid session (Google-authenticated + allowlisted)
// Scoped to /api/* and /ws — static files and /auth are public (above)
app.use('/api/*', authMiddleware);
app.use('/ws', authMiddleware);

// WebSocket chat route (agent path)
app.get('/ws', upgradeWebSocket(handleWebSocket));

// REST API routes (direct UI path)
app.route('/api', apiRoutes); // see routes.ts

const port = Number(process.env.PORT) || 3000;
const server = serve({ fetch: app.fetch, port });
injectWebSocket(server);

process.on('SIGTERM', () => {
  console.warn('SIGTERM received, shutting down gracefully');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
});
```

---

## WebSocket Chat Route

The WebSocket route in `src/server/agent.ts` manages Agent SDK sessions scoped to a conversation. Each WebSocket connection is tied to a `conversationId` passed as a query parameter. The backend persists all messages to Postgres for durable UI history, while the SDK manages its own context internally.

```typescript
// src/server/agent.ts (conceptual)
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { createCustomMcpServer } from './tools';
import * as queries from './db/queries';

// Shared options for all query() calls — see 02_agent_spec.md for full config
const baseOptions = {
  model: 'claude-opus-4-6',
  systemPrompt: SYSTEM_PROMPT,
  permissionMode: 'bypassPermissions' as const,  // Our tools are in-process; approval is prompt-enforced
  allowedTools: ['mcp__assistant-tools__sync_email', 'mcp__assistant-tools__action_email',
    'mcp__assistant-tools__calendar', 'mcp__assistant-tools__drive',
    'mcp__assistant-tools__buckets', 'Agent'],  // Agent required for subagents
  mcpServers: {
    'assistant-tools': createCustomMcpServer(),
  },
  agents: agentDefinitions,  // email-classifier, meeting-prepper, researcher — see 02_agent_spec.md
  persistSession: true,
};

// Stream a query() call over WebSocket, returning the full assistant text
async function streamQuery(
  ws: WebSocket,
  conversationId: string,
  prompt: string,
  sessionId?: string,
): Promise<string> {
  let options = sessionId
    ? { ...baseOptions, resume: sessionId }
    : { ...baseOptions };

  let fullText = '';
  let resolvedSessionId: string | undefined;

  // If resume fails (session file lost after redeploy), retry without resume.
  // Wrap query() in a try/catch — if the SDK throws on stale session, start fresh.
  let q: Query;
  try {
    q = query({ prompt, options });
  } catch {
    options = { ...baseOptions };
    q = query({ prompt, options });
  }

  for await (const message of q) {
    // Capture session ID from init or result messages
    if ('session_id' in message) {
      resolvedSessionId = message.session_id;
    }

    if (message.type === 'assistant') {
      // Assistant message contains text and/or tool_use content blocks
      // Forward text content to the client for streaming display
      for (const block of message.message.content) {
        if (block.type === 'text') {
          ws.send(JSON.stringify({ type: 'text_delta', content: block.text }));
          fullText += block.text;
        }
      }
    }

    if (message.type === 'result') {
      // Final result — use result text as authoritative response if present
      if (message.result) {
        fullText = message.result;
      }
    }
  }

  // Persist session ID if this was a new session or it changed
  if (resolvedSessionId) {
    await queries.updateConversation(conversationId, {
      sdk_session_id: resolvedSessionId,
    });
  }

  // Send final text and persist assistant message
  ws.send(JSON.stringify({ type: 'text_done', content: fullText }));
  await queries.createChatMessage(conversationId, 'assistant', fullText);

  return fullText;
}

export function handleWebSocket(ws: WebSocket): void {
  const url = new URL(ws.url);
  const conversationId = url.searchParams.get('conversationId');
  if (!conversationId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing conversationId' }));
    ws.close();
    return;
  }

  // Validate conversationId exists before accepting messages
  const conversation = await queries.getConversation(conversationId);
  if (!conversation) {
    ws.send(JSON.stringify({ type: 'error', message: 'Conversation not found' }));
    ws.close();
    return;
  }

  // Zod schema for incoming WebSocket messages
  const wsMessageSchema = z.object({ type: z.literal('chat'), content: z.string().min(1) });

  ws.onmessage = async (event: MessageEvent) => {
    const data = typeof event.data === 'string' ? event.data : String(event.data);
    let msg;
    try {
      msg = wsMessageSchema.parse(JSON.parse(data));
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      return;
    }

    // Validate conversation exists
    const conversation = await queries.getConversation(conversationId);
    if (!conversation) {
      ws.send(JSON.stringify({ type: 'error', message: 'Conversation not found' }));
      return;
    }

    const sessionId = conversation.sdk_session_id ?? undefined;

    if (msg.type === 'chat') {
      // Persist user message to Postgres
      await queries.createChatMessage(conversationId, 'user', msg.content);

      // Auto-title on first user message
      const messages = await queries.listMessagesByConversation(conversationId);
      const userMessages = messages.filter(m => m.role === 'user');
      if (userMessages.length === 1) {
        const title = msg.content.slice(0, 80);
        await queries.updateConversation(conversationId, { title });
        ws.send(JSON.stringify({ type: 'conversation_updated', conversationId, title }));
      }

      // Stream agent response — resume existing session if available
      await streamQuery(ws, conversationId, msg.content, sessionId);
    }

    // Approval is handled via regular chat messages — the user types "go ahead",
    // "yes", "no", etc. in natural language. No special message types needed.
  };

  ws.onclose = () => {
    // Do NOT destroy session — it persists on disk for future resume
  };
}
```

### Session Management

- Each WebSocket connection is scoped to a single conversation (via `conversationId` query param)
- SDK session is resumed if `sdk_session_id` exists on the conversation and the session file is still on disk
- If the SDK session file is lost (Railway redeploy, scale-to-zero), `query()` with `resume` will throw — the catch block retries without `resume`, starting a fresh session. The conversation's `sdk_session_id` is updated to the new value
- When SDK session is lost, past messages remain in Postgres for UI display but agent context resets — the user effectively starts fresh from the agent's perspective while retaining visible history
- SDK handles compaction internally when context approaches limits. Postgres messages are unaffected — they remain the full history for UI display
- On WebSocket close, the SDK session is NOT destroyed — it persists for future resume

---

## Data Freshness

There is no server-side event bus or `data_changed` push mechanism. The WebSocket exists only for agent chat streaming.

Frontend data hooks (`useBuckets`, `useCalendarEvents`, `useConversations`) stay fresh via two mechanisms:

1. **After own mutations** — each hook calls `refetch()` after its own mutation functions succeed (e.g., `createBucket` → `refetch()`)
2. **After agent responses** — when the Chat component receives `text_done` (agent finished responding), it triggers a refetch on all active data hooks. This catches agent-initiated writes (e.g., bucket assignments, calendar event creation) without needing a server-side event system.

Brief staleness during agent execution is acceptable — the user is watching the agent's streamed text in the chat panel, and data panels refresh once the response completes.

No `events.ts`, no `EventEmitter`, no `emitDataChanged()`, no `data_changed` WebSocket message type.

---

## In-Process MCP Server (5 Tools)

```typescript
// src/server/tools.ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as email from './email';
import * as queries from './db/queries';
import * as calendar from './google/calendar';
import * as drive from './google/drive';
import { AppError } from './exceptions';

const BATCH_SIZE = 25;

export function createCustomMcpServer() {
  return createSdkMcpServer({
    name: 'assistant-tools',
    version: '1.0.0',
    tools: [

      tool(
        'buckets',
        'Manage email buckets and assign threads to them. Buckets are categories for organizing email threads.',
        {
          action: z.enum(['list', 'create', 'update', 'delete', 'assign']),
          id: z.string().optional().describe('Bucket ID (for update/delete)'),
          name: z.string().optional().describe('Bucket name (for create/update)'),
          description: z.string().optional().describe('Bucket description (for create/update)'),
          sort_order: z.number().optional().describe('Display order (for update)'),
          assignments: z.array(z.object({
            gmail_thread_id: z.string(),
            bucket_id: z.string(),
            subject: z.string().optional(),
            snippet: z.string().optional(),
          })).max(BATCH_SIZE).optional().describe('Thread-to-bucket assignments (1-25). For assign action.'),
        },
        async (params) => {
          switch (params.action) {
            case 'list':
              return { content: [{ type: 'text' as const, text: JSON.stringify(await queries.listBuckets()) }] };
            case 'create': {
              const result = await queries.createBucket(params.name!, params.description!);
              await queries.markAllForRebucket();

              return { content: [{ type: 'text' as const, text: JSON.stringify({
                ...result,
                rebucket_required: true,
                message: `Bucket "${params.name}" created. All threads need re-evaluation.`,
              }) }] };
            }
            case 'update': {
              const result = await queries.updateBucket(params.id!, params);

              return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
            }
            case 'delete': {
              await queries.deleteBucket(params.id!);

              return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }] };
            }
            case 'assign': {
              if (!params.assignments || params.assignments.length > BATCH_SIZE) {
                throw new AppError(`Assignments required, max ${BATCH_SIZE} per batch`, 400);
              }
              const result = await queries.assignThreadsBatch(params.assignments);

              return { content: [{ type: 'text' as const, text: JSON.stringify({
                assigned: result.length,
                remaining: await queries.countUnbucketedThreads(),
              }) }] };
            }
          }
        },
      ),

      tool(
        'sync_email',
        'Read email data. All email reads go through this tool. Actions: sync (bulk inbox refresh), search (find specific threads), get_thread (single thread), get_unbucketed (for bucketing workflow).',
        {
          action: z.enum(['sync', 'search', 'get_thread', 'get_unbucketed']),
          query: z.string().optional().describe('Gmail search query (e.g., "from:dan@acme.co", "subject:contract")'),
          max_results: z.number().optional().describe('Max threads for sync/search (default 200 for sync, 25 for search)'),
          thread_id: z.string().optional().describe('Gmail thread ID for get_thread action'),
        },
        async (params) => {
          let result;
          switch (params.action) {
            case 'sync':
              result = await email.syncInbox(params.max_results);
              break;
            case 'search':
              result = await email.search(params.query!, params.max_results);
              break;
            case 'get_thread':
              result = await email.getThread(params.thread_id!);
              break;
            case 'get_unbucketed':
              result = await email.getUnbucketedThreads();
              break;
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
      ),

      tool(
        'action_email',
        'Perform actions on emails: send, reply, draft, archive, mark as read. All write operations require user approval.',
        {
          action: z.enum(['send', 'reply', 'draft', 'archive', 'mark_read']),
          to: z.string().optional(),
          cc: z.array(z.string()).optional(),
          subject: z.string().optional(),
          body: z.string().optional(),
          thread_id: z.string().optional(),
          message_id: z.string().optional(),
        },
        async (params) => {
          let result;
          switch (params.action) {
            case 'send':
              result = await email.sendMessage(params.to!, params.subject!, params.body!, { cc: params.cc });
              break;
            case 'reply':
              result = await email.replyToThread(params.thread_id!, params.message_id!, params.body!);
              break;
            case 'draft':
              result = await email.createDraft(params.to!, params.subject!, params.body!, params.thread_id);
              break;
            case 'archive':
              await email.archiveThread(params.thread_id!);
              result = { ok: true };
              break;
            case 'mark_read':
              await email.markAsRead(params.message_id!);
              result = { ok: true };
              break;
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
      ),

      tool(
        'calendar',
        'Read, create, update, and delete Google Calendar events. Check availability. Write actions (create, update, delete) require user approval.',
        {
          action: z.enum(['list', 'get', 'create', 'update', 'delete', 'free_busy']),
          time_min: z.string().optional().describe('ISO 8601 datetime (list, free_busy)'),
          time_max: z.string().optional().describe('ISO 8601 datetime (list, free_busy)'),
          event_id: z.string().optional().describe('Event ID (get, update, delete)'),
          summary: z.string().optional().describe('Event title (create, update)'),
          description: z.string().optional().describe('Event description (create, update)'),
          location: z.string().optional().describe('Event location (create, update)'),
          start: z.string().optional().describe('ISO 8601 start time (create, update)'),
          end: z.string().optional().describe('ISO 8601 end time (create, update)'),
          attendees: z.array(z.string()).optional().describe('Email addresses (create, update)'),
          query: z.string().optional().describe('Free text search (list)'),
        },
        async (params) => {
          let result;
          switch (params.action) {
            case 'list':
              result = await calendar.listEvents(params.time_min!, params.time_max!, {
                q: params.query,
              });
              break;
            case 'get':
              result = await calendar.getEvent(params.event_id!);
              break;
            case 'create':
              result = await calendar.createEvent({
                summary: params.summary!,
                description: params.description,
                location: params.location,
                start: params.start!,
                end: params.end!,
                attendees: params.attendees,
              });
              break;
            case 'update':
              result = await calendar.updateEvent(params.event_id!, {
                summary: params.summary,
                description: params.description,
                location: params.location,
                start: params.start,
                end: params.end,
                attendees: params.attendees,
              });
              break;
            case 'delete':
              await calendar.deleteEvent(params.event_id!);
              result = { ok: true };
              break;
            case 'free_busy':
              result = await calendar.checkFreeBusy(params.time_min!, params.time_max!);
              break;
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
      ),

      tool(
        'drive',
        'Search Google Drive files and read Google Docs content. Read-only — no confirmation needed.',
        {
          action: z.enum(['search', 'list_recent', 'read', 'metadata']),
          query: z.string().optional().describe('Search query (search)'),
          file_id: z.string().optional().describe('File ID (read, metadata)'),
          max_results: z.number().optional().describe('Max results (search, list_recent)'),
        },
        async (params) => {
          let result;
          switch (params.action) {
            case 'search':
              result = await drive.searchFiles(params.query!, { maxResults: params.max_results });
              break;
            case 'list_recent':
              result = await drive.listRecentFiles(params.max_results);
              break;
            case 'read':
              result = await drive.readDocument(params.file_id!);
              break;
            case 'metadata':
              result = await drive.getFileMetadata(params.file_id!);
              break;
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
      ),

    ],
  });
}
```

---

## Email Orchestration Layer

`src/server/email.ts` coordinates between `google/gmail.ts` (Google API) and `db/queries.ts` (Postgres). All email reads — whether from MCP tools or REST routes — go through this layer so the local cache stays consistent.

```typescript
// src/server/email.ts
import * as gmail from './google/gmail';
import * as queries from './db/queries';
import pLimit from 'p-limit';

const BATCH_SIZE = 25;
const DEFAULT_SYNC_LIMIT = 200;
const limit = pLimit(5);

/**
 * Bulk inbox refresh. Fetches recent thread IDs from Gmail, diffs against
 * local DB, only fetches full content for new or changed threads.
 * Returns stats only — use get_unbucketed to process results.
 */
export async function syncInbox(maxResults?: number): Promise<{ new: number; updated: number }> {
  const syncLimit = maxResults || DEFAULT_SYNC_LIMIT;
  const gmailThreads = await gmail.searchThreads('is:inbox', syncLimit);

  // Diff: check which threads we already have and whether they've changed
  const gmailIds = gmailThreads.map(t => t.id);
  const existing = await queries.listEmailThreadsByGmailIds(gmailIds);
  const existingMap = new Map(existing.map(t => [t.gmail_thread_id, t]));

  let newCount = 0;
  let updatedCount = 0;

  // Fetch threads in parallel with concurrency limit to respect Gmail rate limits
  const threadsToSync = gmailThreads.filter(thread => {
    const local = existingMap.get(thread.id);
    return !local || local.snippet !== thread.snippet;
  });

  await Promise.all(threadsToSync.map(thread => limit(async () => {
    const local = existingMap.get(thread.id);
    const isNew = !local;
    const full = await gmail.getThread(thread.id);
    await queries.upsertEmailThread(full);
    await queries.upsertEmailMessages(full.messages);
    isNew ? newCount++ : updatedCount++;
  })));

  return { new: newCount, updated: updatedCount };
}

/**
 * Ad-hoc Gmail search. Syncs matching threads to local DB, returns
 * the matched threads from DB. Use for "find threads from Dan",
 * meeting prep, draft reply context, etc.
 */
export async function search(query: string, maxResults?: number) {
  const resultLimit = Math.min(maxResults || BATCH_SIZE, BATCH_SIZE);
  const gmailThreads = await gmail.searchThreads(query, resultLimit);

  // Sync matching threads to local cache using the same module-level pLimit(5) concurrency pool as syncInbox
  await Promise.all(gmailThreads.map(thread => limit(async () => {
    const full = await gmail.getThread(thread.id);
    await queries.upsertEmailThread(full);
    await queries.upsertEmailMessages(full.messages);
  })));

  // Return from DB (consistent shape, includes local-only fields)
  const gmailIds = gmailThreads.map(t => t.id);
  return queries.listEmailThreadsByGmailIds(gmailIds);
}

/**
 * Single thread by ID. Syncs from Gmail if not cached or stale,
 * returns from DB with full messages.
 */
export async function getThread(gmailThreadId: string) {
  const full = await gmail.getThread(gmailThreadId);
  await queries.upsertEmailThread(full);
  await queries.upsertEmailMessages(full.messages);
  return queries.getEmailThread(gmailThreadId);
}

/**
 * Returns next batch of unbucketed threads from local DB.
 * Pure DB read — no Gmail call. Used by the bucketing workflow.
 */
export async function getUnbucketedThreads() {
  const threads = await queries.getUnbucketedThreads(BATCH_SIZE);
  return { unbucketed: threads.length, threads };
}

// --- Email write operations ---
// All writes go through email.ts so tools and routes share the same path.

export async function sendMessage(to: string, subject: string, body: string, opts?: { cc?: string[] }) {
  return gmail.sendMessage(to, subject, body, opts);
}

export async function replyToThread(threadId: string, messageId: string, body: string) {
  return gmail.replyToThread(threadId, messageId, body);
}

export async function createDraft(to: string, subject: string, body: string, threadId?: string) {
  return gmail.createDraft(to, subject, body, threadId);
}

export async function archiveThread(gmailThreadId: string) {
  await gmail.archiveThread(gmailThreadId);
}

export async function markAsRead(messageId: string) {
  await gmail.markAsRead(messageId);
}
```

### Diff-Based Sync Logic

`syncInbox` avoids re-fetching threads that haven't changed:

1. `gmail.searchThreads('is:inbox', 200)` — returns thread IDs + snippets (cheap, no message bodies)
2. `queries.listEmailThreadsByGmailIds(ids)` — looks up which threads are already in `email_threads`
3. For each thread: if not in DB (new) or snippet changed (updated), fetch full content via `gmail.getThread()` and upsert
4. Threads already in DB with unchanged snippets are skipped entirely

This means a typical "Start Day" sync of 200 inbox threads only makes full API calls for the ~10-20 that are actually new since the last sync.

---

## Auth — Google OAuth + Email Allowlist

Single auth flow: Google OAuth handles both login and API access. An email allowlist (`ALLOWED_USERS` env var) restricts who can use the app.

Cookie-only auth model: one httpOnly session cookie authenticates all requests (REST and WebSocket). CSRF protection via an `X-CSRF-Token` header required on state-changing requests (POST/PUT/PATCH/DELETE).

```typescript
// src/server/auth.ts
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { sign, verify } from 'hono/jwt';
import { google } from 'googleapis';
import crypto from 'node:crypto';
import { getAuthClient, persistTokens } from './google/auth';

const rawAllowedUsers = process.env.ALLOWED_USERS;
if (!rawAllowedUsers) throw new Error('Missing required env var: ALLOWED_USERS');
const ALLOWED_USERS = rawAllowedUsers.split(',').map(e => e.trim().toLowerCase());

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('Missing required env var: JWT_SECRET');

export const googleAuthRoutes = new Hono();

// Initiate Google OAuth — login + API scopes in one step
googleAuthRoutes.get('/google', (c) => {
  const oauth2Client = getAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });
  return c.redirect(url);
});

// OAuth callback — verify allowlist, set session cookie, redirect to app
googleAuthRoutes.get('/google/callback', async (c) => {
  const error = c.req.query('error');
  if (error) {
    return c.redirect('/?auth_error=' + encodeURIComponent(error));
  }

  const code = c.req.query('code');
  if (!code) {
    return c.json({ error: 'Missing authorization code' }, 400);
  }

  const oauth2Client = getAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  const email = data.email?.toLowerCase();

  if (!email || !ALLOWED_USERS.includes(email)) {
    return c.json({ error: 'Not authorized. Contact the admin.' }, 403);
  }

  await persistTokens(tokens);

  // Create JWT session — stored only in httpOnly cookie, never exposed to JS or URLs
  const token = await sign({ email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, JWT_SECRET);

  setCookie(c, 'session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  // Redirect to app root — no token in URL
  return c.redirect('/');
});

// Logout
googleAuthRoutes.get('/logout', (c) => {
  setCookie(c, 'session', '', { maxAge: 0 });
  return c.redirect('/');
});

// Session status — returns CSRF token when authenticated
googleAuthRoutes.get('/status', async (c) => {
  const session = getCookie(c, 'session');
  if (!session) return c.json({ authenticated: false });
  try {
    await verify(session, JWT_SECRET);
    // CSRF token: HMAC of the session JWT using JWT_SECRET.
    // Deterministic per session — frontend fetches on load and attaches
    // to state-changing requests. Attacker cannot read this response
    // cross-origin, so they cannot forge the header.
    const csrfToken = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(session)
      .digest('hex');
    return c.json({ authenticated: true, csrfToken });
  } catch (err) {
    console.warn('Session verification failed', { error: err });
    return c.json({ authenticated: false });
  }
});

// Auth middleware — cookie-only, all routes
export const authMiddleware = createMiddleware(async (c, next) => {
  const session = getCookie(c, 'session');
  if (!session) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const payload = await verify(session, JWT_SECRET);
    c.set('userEmail', payload.email);
  } catch (err) {
    console.warn('Auth middleware: session verification failed', { error: err });
    return c.json({ error: 'Invalid session' }, 401);
  }

  // CSRF check on state-changing methods
  const method = c.req.method;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    const csrfHeader = c.req.header('X-CSRF-Token');
    const expected = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(session)
      .digest('hex');
    if (csrfHeader !== expected) {
      return c.json({ error: 'Invalid CSRF token' }, 403);
    }
  }

  await next();
});
```

### Flow

1. User visits app → not logged in → frontend redirects to `/auth/google`
2. Google consent screen (login + Gmail/Calendar/Drive scopes) → callback
3. Backend gets user's email via `oauth2.userinfo.get()` → checks `ALLOWED_USERS`
4. If not on the list → 403. If allowed → persist Google tokens, set httpOnly session cookie, redirect to `/`
5. Frontend calls `GET /auth/status` → gets `{ authenticated: true, csrfToken }` → stores CSRF token in memory
6. All REST calls use the session cookie (browser auto-attaches) + `X-CSRF-Token` header on POST/PUT/PATCH/DELETE
7. WebSocket upgrade uses the session cookie (browser auto-attaches on same-origin request)
8. `googleapis` OAuth2Client auto-refreshes API tokens; `auth.ts` re-persists on `tokens` event
9. On page refresh: same flow as step 5 — `GET /auth/status` re-fetches the CSRF token. Session cookie survives refresh.

### CSRF Protection

The CSRF token is an HMAC of the session cookie using `JWT_SECRET`. It's deterministic per session, so the frontend can re-fetch it on any page load via `GET /auth/status`. A cross-origin attacker can trigger cookie-authenticated requests but cannot read the `/auth/status` response (blocked by same-origin policy), so they cannot obtain the CSRF token to include in the `X-CSRF-Token` header.

State-changing methods (POST/PUT/PATCH/DELETE) require the header. GET requests and WebSocket upgrades do not — GETs are side-effect-free, and WebSocket is protected by `sameSite: 'Strict'` on the cookie.

### Token Sharing — How It's Wired

There is one `OAuth2Client` instance, created and managed in `src/server/google/auth.ts`. Both the login flow (`src/server/auth.ts`) and all Google connectors (`gmail.ts`, `calendar.ts`, `drive.ts`) use the same instance:

1. `src/server/auth.ts` imports `getAuthClient()` and `persistTokens()` from `./google/auth`
2. During OAuth callback, `auth.ts` calls `oauth2Client.getToken(code)` to exchange the auth code, then calls `persistTokens(tokens)` to store them in the `google_tokens` Postgres table
3. `src/server/google/auth.ts` reads persisted tokens at startup via `getAuthClient()`, which creates the `OAuth2Client` and loads tokens from the `google_tokens` table
4. All connectors call `getAuthClient()` to get the shared instance — it's a module-level singleton
5. The `OAuth2Client` auto-refreshes expired access tokens; `google/auth.ts` listens for the `tokens` event and re-persists to Postgres

---

## REST API (Direct UI Path)

These endpoints let the frontend perform actions directly without going through the agent. Email reads go through `email.ts` (same orchestration layer the MCP tools use). Email writes and non-email actions use `google/*` connectors directly.

### Response Pattern

No response envelope or decorator. Routes use `c.json()` directly. Errors propagate to `app.onError()`:

- **Validation errors** — Zod throws `ZodError` on `.parse()`, caught by `app.onError` → `400`
- **Domain errors** — `AppError` thrown by queries/connectors, caught by `app.onError` → status from error
- **Unexpected errors** — caught by `app.onError` → `500`

### Schemas & Route Setup

Zod schemas are defined inline in `routes.ts` — they're only used there. No separate `schemas.ts` file.

```typescript
// src/server/routes.ts
import { Hono } from 'hono';
import { z } from 'zod';
import * as email from './email';
import * as calendar from './google/calendar';
import * as drive from './google/drive';
import * as queries from './db/queries';
export const apiRoutes = new Hono();

// --- Schemas (inline, used only by route handlers below) ---

// Gmail
const sendEmailSchema = z.object({
  to: z.string().email(),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

const replySchema = z.object({
  body: z.string().min(1),
  messageId: z.string().min(1), // This is the gmail_message_id (not the Postgres UUID)
});

// Calendar
const createEventSchema = z.object({
  summary: z.string().min(1),
  start: z.string().datetime(),
  end: z.string().datetime(),
  attendees: z.array(z.string().email()).optional(),
  description: z.string().optional(),
  location: z.string().optional(),
});

const updateEventSchema = createEventSchema.partial();

// Buckets
const createBucketSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

const updateBucketSchema = createBucketSchema.partial().extend({
  sort_order: z.number().int().optional(),
});

const assignThreadSchema = z.object({
  gmail_thread_id: z.string().min(1),
  bucket_id: z.string().uuid(),
  subject: z.string().optional(),
  snippet: z.string().optional(),
});

// Conversations
const createConversationSchema = z.object({
  title: z.string().min(1).optional(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1),
});
```

### Gmail

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/gmail/threads` | List threads. Query: `?q=...&maxResults=25` (max 25, capped by BATCH_SIZE) |
| `GET` | `/api/gmail/threads/:id` | Get full thread (all messages with decoded bodies) |
| `POST` | `/api/gmail/send` | Send a new email. Body: `{ to, cc?, subject, body }` |
| `POST` | `/api/gmail/threads/:id/reply` | Reply to a thread. Body: `{ body }` |
| `POST` | `/api/gmail/threads/:id/archive` | Archive a thread (remove INBOX label from all messages) |
| `POST` | `/api/gmail/messages/:id/read` | Mark as read |

```typescript
// Gmail routes — reads go through email.ts orchestration layer (syncs to local cache)
apiRoutes.get('/gmail/threads', async (c) => {
  const q = c.req.query('q') || 'is:inbox';
  const maxResults = Number(c.req.query('maxResults')) || 25;
  const threads = await email.search(q, maxResults);
  return c.json(threads);
});

apiRoutes.get('/gmail/threads/:id', async (c) => {
  const thread = await email.getThread(c.req.param('id'));
  return c.json(thread);
});

apiRoutes.post('/gmail/send', async (c) => {
  const body = sendEmailSchema.parse(await c.req.json());
  const result = await email.sendMessage(body.to, body.subject, body.body, { cc: body.cc });
  return c.json(result, 201);
});

apiRoutes.post('/gmail/threads/:id/reply', async (c) => {
  const body = replySchema.parse(await c.req.json());
  const result = await email.replyToThread(c.req.param('id'), body.messageId, body.body);
  return c.json(result, 201);
});

apiRoutes.post('/gmail/threads/:id/archive', async (c) => {
  await email.archiveThread(c.req.param('id'));
  return c.json({ ok: true });
});

apiRoutes.post('/gmail/messages/:id/read', async (c) => {
  await email.markAsRead(c.req.param('id'));
  return c.json({ ok: true });
});
```

### Calendar

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/calendar/events` | List events. Query: `?timeMin=...&timeMax=...&maxResults=25` |
| `GET` | `/api/calendar/events/:id` | Get event details |
| `POST` | `/api/calendar/events` | Create event. Body: `{ summary, start, end, attendees?, description?, location? }` |
| `PATCH` | `/api/calendar/events/:id` | Update event (partial). Body: any event fields |
| `DELETE` | `/api/calendar/events/:id` | Delete/cancel event |

```typescript
// Calendar routes
apiRoutes.get('/calendar/events', async (c) => {
  const timeMin = c.req.query('timeMin') || new Date().toISOString();
  // Default timeMax to end of current day (midnight tonight UTC) if not provided
  const now = new Date();
  const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const timeMax = c.req.query('timeMax') || endOfDay.toISOString();
  const maxResults = Number(c.req.query('maxResults')) || 25;
  const events = await calendar.listEvents(timeMin, timeMax, { maxResults });
  return c.json(events);
});

apiRoutes.get('/calendar/events/:id', async (c) => {
  const event = await calendar.getEvent(c.req.param('id'));
  return c.json(event);
});

apiRoutes.post('/calendar/events', async (c) => {
  const body = createEventSchema.parse(await c.req.json());
  const event = await calendar.createEvent(body);
  return c.json(event, 201);
});

apiRoutes.patch('/calendar/events/:id', async (c) => {
  const body = updateEventSchema.parse(await c.req.json());
  const event = await calendar.updateEvent(c.req.param('id'), body);
  return c.json(event);
});

apiRoutes.delete('/calendar/events/:id', async (c) => {
  await calendar.deleteEvent(c.req.param('id'));
  return c.json({ ok: true });
});
```

### Buckets

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/buckets` | List all buckets with assigned threads |
| `POST` | `/api/buckets` | Create a bucket. Body: `{ name, description }` |
| `PATCH` | `/api/buckets/:id` | Update a bucket |
| `DELETE` | `/api/buckets/:id` | Delete a bucket |
| `POST` | `/api/buckets/assign` | Assign a thread to a bucket. Body: `{ gmail_thread_id, bucket_id }` |

```typescript
// Bucket routes
apiRoutes.get('/buckets', async (c) => {
  const buckets = await queries.listBucketsWithThreads();
  return c.json(buckets);
});

apiRoutes.post('/buckets', async (c) => {
  const body = createBucketSchema.parse(await c.req.json());
  const bucket = await queries.createBucket(body.name, body.description);
  return c.json({ ...bucket, rebucket_required: true }, 201);
});

apiRoutes.patch('/buckets/:id', async (c) => {
  const body = updateBucketSchema.parse(await c.req.json());
  const bucket = await queries.updateBucket(c.req.param('id'), body);
  return c.json(bucket);
});

apiRoutes.delete('/buckets/:id', async (c) => {
  await queries.deleteBucket(c.req.param('id'));
  return c.json({ ok: true });
});

apiRoutes.post('/buckets/assign', async (c) => {
  const body = assignThreadSchema.parse(await c.req.json());
  await queries.assignThread(body.gmail_thread_id, body.bucket_id, body.subject, body.snippet);
  return c.json({ ok: true });
});
```

### Bucket Templates

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/bucket-templates` | List all available templates |
| `GET` | `/api/bucket-templates/:id` | Get a template with its bucket definitions |
| `POST` | `/api/bucket-templates/:id/apply` | Apply a template — creates buckets from the template's definitions |

```typescript
// Bucket template routes
apiRoutes.get('/bucket-templates', async (c) => {
  const templates = await queries.listBucketTemplates();
  return c.json(templates);
});

apiRoutes.get('/bucket-templates/:id', async (c) => {
  const template = await queries.getBucketTemplate(c.req.param('id'));
  return c.json(template);
});

apiRoutes.post('/bucket-templates/:id/apply', async (c) => {
  const buckets = await queries.applyBucketTemplate(c.req.param('id'));
  return c.json(buckets, 201);
});
```

### Conversations

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/conversations` | List all conversations, ordered by updated_at DESC |
| `POST` | `/api/conversations` | Create a new conversation. Body: `{ title? }` |
| `GET` | `/api/conversations/:id` | Get a conversation with its messages |
| `PATCH` | `/api/conversations/:id` | Rename a conversation. Body: `{ title }` |
| `DELETE` | `/api/conversations/:id` | Delete a conversation and all its messages |

```typescript
// Conversation routes
apiRoutes.get('/conversations', async (c) => {
  const conversations = await queries.listConversations();
  return c.json(conversations);
});

apiRoutes.post('/conversations', async (c) => {
  const body = createConversationSchema.parse(await c.req.json());
  const conversation = await queries.createConversation(body.title ?? 'New conversation');
  return c.json(conversation, 201);
});

apiRoutes.get('/conversations/:id', async (c) => {
  const conversation = await queries.getConversation(c.req.param('id'));
  const messages = await queries.listMessagesByConversation(c.req.param('id'));
  return c.json({ ...conversation, messages });
});

apiRoutes.patch('/conversations/:id', async (c) => {
  const body = updateConversationSchema.parse(await c.req.json());
  const conversation = await queries.updateConversation(c.req.param('id'), { title: body.title });
  return c.json(conversation);
});

apiRoutes.delete('/conversations/:id', async (c) => {
  await queries.deleteConversation(c.req.param('id'));
  return c.json({ ok: true });
});
```

---

## Environment Variables

```
ALLOWED_USERS=          # Comma-separated emails, e.g. davis@gmail.com,friend@example.com
JWT_SECRET=             # Secret for signing session JWTs
DATABASE_URL=           # Postgres connection string
GOOGLE_CLIENT_ID=       # Google OAuth client ID
GOOGLE_CLIENT_SECRET=   # Google OAuth client secret
GOOGLE_REDIRECT_URI=    # e.g., http://localhost:3000/auth/google/callback
ANTHROPIC_API_KEY=      # For Claude Agent SDK
ENCRYPTION_KEY=         # AES-256-GCM key for token encryption at rest (openssl rand -hex 32)
```
