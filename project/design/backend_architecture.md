# Backend Architecture

## Overview

The backend is a Node.js server that serves three callers: the frontend (via HTTP/WebSocket), the agent system (via orchestrator tools), and the heartbeat (via cron). All three flow through a shared business logic layer.

---

## Layers

| Layer | Location | Responsibility |
|---|---|---|
| Routes | `routes/` | Hono handlers. Parse request, call core, return response. |
| Core | `core/` | Business logic. Transactions, validation, state machines, orchestration. |
| DB | `db/` | Drizzle query functions. Receives `db \| tx`, returns typed data. No business logic. |
| Connectors | `connectors/` | External API adapters: Gmail, Calendar, Drive. Interface-based. |
| Agents | `agents/` | Claude Agent SDK orchestrator + subagents. Call core, not db. |
| Auth | `auth/` | Google OAuth flow, token refresh, route middleware. |
| Middleware | `middleware/` | Hono middleware: request ID, request logging, CORS. Runs before route handlers. |
| Infra | `infra/` | Cross-cutting infrastructure: logging, WebSocket management. Imported by any layer. |

### Data Flow

```
User (HTTP)     →  routes/     →  core/  →  db/
                                          →  connectors/

User (chat/     →  routes/     →  agents/  →  core/  →  db/
 async ops)        agent.ts                           →  connectors/

Agent (tools)   →  agents/     →  core/  →  db/
                                          →  connectors/

Heartbeat       →  cron job    →  agents/  →  core/  →  db/
                                                      →  connectors/
```

`core/` is the single point of business logic regardless of caller. Core handles data operations only — no LLM calls, no classification, no message drafting. Agent-driven workflows (sort inbox, prep meeting, briefing generation) flow through `agents/` which calls `core/` for persistence.

---

## Directory Structure

```
packages/backend/src/
  routes/                    ← Hono handlers
    threads.ts
    buckets.ts
    tasks.ts
    events.ts
    people.ts
    actions.ts
    briefings.ts
    agent.ts                 ← Conversation + async agent ops (Start Day, etc.)
    auth.ts                  ← Google OAuth flow (public routes)
  core/                      ← Business logic (data ops only — no LLM)
    threads.ts
    buckets.ts
    tasks.ts
    events.ts
    people.ts
    actions.ts
    briefings.ts
    preferences.ts           ← File-based preferences read/write
    errors.ts                ← Domain exception classes
  db/                        ← Drizzle queries
    client.ts                ← postgres.js connection + Drizzle instance
    schema.ts                ← Table definitions (type source of truth)
    people.ts
    threads.ts
    buckets.ts
    events.ts
    tasks.ts
    actions.ts
  connectors/                ← External API adapters
    interfaces.ts            ← EmailClient, CalendarClient, DriveClient
    gmail.ts                 ← Implements EmailClient
    google-calendar.ts       ← Implements CalendarClient
    google-drive.ts          ← Implements DriveClient
    rate-limiter.ts          ← Shared rate limiting + retry
  agents/                    ← Agent SDK orchestrator + subagents
    orchestrator.ts
    skills/
      sort-inbox.ts
      investigate-thread.ts
      prep-meeting.ts
      post-meeting.ts
      daily-briefing.ts
      delegate-task.ts
  auth/                      ← Google OAuth
    oauth.ts
    tokens.ts
    middleware.ts
  middleware/                 ← Hono middleware
    request-id.ts            ← Generates request ID, sets on context + response header
    request-logger.ts        ← Logs method, path, status, duration via Pino
    cors.ts                  ← CORS config for frontend dev server
  infra/                     ← Cross-cutting infrastructure
    logger.ts                ← App logger: structured, context-aware
    websocket.ts             ← WebSocket connection manager for frontend push
```

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Data access pattern | Functional modules per entity in `db/` | Matches project's functional style. No classes, no `this`. Plain async functions. |
| Transaction API | Pass `db \| tx` as first argument | Explicit, composable. Same function works standalone or in a transaction. Drizzle's documented pattern. |
| Connection driver | `postgres.js` with Drizzle | Drizzle's recommended pairing. Built-in pooling. No native bindings. |
| Error handling | Domain exceptions in `core/`, mapped to HTTP in `routes/` | `db/` lets errors bubble. `core/` wraps into domain errors. `routes/` maps to status codes. |
| Query return types | Drizzle `$inferSelect` / `$inferInsert`, re-exported from `shared/` | Single source of truth. Type-only dependency — no Drizzle runtime in frontend. |
| Soft delete (People) | Wrapper in `db/people.ts` | Default excludes deleted. Explicit `IncludeDeleted` variant for re-proposal prevention. |
| Connectors | Singleton interface/adapter pattern | Module-level singletons. Any layer imports directly. Testable via module mocking. |
| Rate limiting | Shared wrapper in `connectors/` | Google APIs share per-user quota. One rate limiter, consistent retry, partial failure support. |
| Drizzle containment | `drizzle-orm` imports allowed **only** in `db/` and `shared/types/` | `db/` is the repository layer. If `core/` or `routes/` import Drizzle query primitives (`eq`, `and`, `sql`, etc.), the boundary is broken. Enforced by ESLint. |

---

## Layer Import Rules

Hard boundaries enforced by ESLint `no-restricted-imports`:

| Layer | May import from | Must NOT import from |
|---|---|---|
| `routes/` | `core/`, `agents/` (agent.ts only), `infra/`, `db/schema` (types only), `shared/` | `db/` query functions, `drizzle-orm`, `connectors/` |
| `core/` | `db/`, `connectors/`, `infra/`, `shared/` | `drizzle-orm`, `agents/`, `routes/` |
| `db/` | `drizzle-orm`, `infra/`, `db/schema`, `shared/` | `core/`, `routes/`, `connectors/` |
| `agents/` | `core/`, `connectors/`, `infra/`, `shared/` | `db/`, `drizzle-orm`, `routes/` |
| `middleware/` | `infra/`, `auth/`, `shared/` | `core/`, `db/`, `connectors/`, `agents/` |
| `connectors/` | `infra/`, `shared/` | `core/`, `db/`, `routes/`, `agents/` |
| `infra/` | `shared/` | `core/`, `db/`, `routes/`, `agents/`, `connectors/` |

### ESLint Config (to add at project init)

```typescript
// eslint.config.ts (relevant rules)

// Drizzle containment: only db/ may import drizzle-orm
{
  files: ['src/core/**/*.ts', 'src/routes/**/*.ts', 'src/agents/**/*.ts', 'src/connectors/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        {
          name: 'drizzle-orm',
          message: 'Import drizzle-orm only in db/. Use db/ query functions instead.',
        },
      ],
      patterns: [
        {
          group: ['drizzle-orm/*'],
          message: 'Import drizzle-orm only in db/. Use db/ query functions instead.',
        },
      ],
    }],
  },
},

// Routes must not import db/ query functions or connectors
{
  files: ['src/routes/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['../db/*', '!../db/schema'], message: 'Routes call core/, not db/ directly.' },
        { group: ['../connectors/*'], message: 'Routes call core/, not connectors/ directly.' },
      ],
    }],
  },
},
```

This makes layer boundaries a CI-level guarantee, not just a convention.

---

## Connection Management

Single `postgres.js` instance shared across the app:

```typescript
// db/client.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const client = postgres(process.env.DATABASE_URL!, { max: 10 });
export const db = drizzle(client, { schema });

export type DB = typeof db;
```

`max: 10` is sufficient for a single-user app running API requests, heartbeat, and agent operations concurrently.

---

## Transactions

### API

`db/` functions accept `db | tx` as their first argument. `core/` decides when to wrap in a transaction:

```typescript
// db/people.ts
export async function create(db: DB, data: PersonInsert): Promise<Person> {
  const [row] = await db.insert(people).values(data).returning();
  return row;
}

// core/threads.ts
export async function applyInvestigationPlan(
  db: DB,
  threadId: string,
  plan: InvestigationPlan
) {
  await db.transaction(async (tx) => {
    for (const person of plan.newPeople) {
      await peopleDb.create(tx, person);
    }
    for (const task of plan.extractedTasks) {
      await tasksDb.create(tx, task);
    }
    for (const action of plan.actions) {
      await actionsDb.create(tx, action);
    }
  });
}
```

### Transaction Boundaries

| Operation | Transactional | Why |
|---|---|---|
| Action approval + execution | Split (see below) | External API call can't be inside a DB transaction |
| Re-sort Inbox | Yes | Partial re-sort is a broken state |
| Delete bucket | Yes | Re-sort threads out, then delete |
| Investigate Thread | Yes | Creates people + tasks + actions atomically |
| Post-Meeting Processing | Yes | Updates event + creates tasks + creates actions |
| Sort Inbox (batch classify) | No | Each thread is independent — partial success is valid |
| Heartbeat (overall) | No | Each step is independent |
| Single entity CRUD | No | Already atomic in Postgres |

### Side-Effect Actions (Split Transaction)

When an action involves an external API call (sending email, creating calendar event), the transaction splits around the external call:

```typescript
// core/actions.ts
export async function executeAction(db: DB, actionId: string) {
  // Step 1: Mark approved
  await actionsDb.transition(db, actionId, 'approved');

  // Step 2: Execute external side effect (outside transaction)
  try {
    const result = await executeExternalOperation(action);

    // Step 3: Mark executed
    await actionsDb.markExecuted(db, actionId, result);
  } catch (err) {
    // Step 3 (failure): Mark failed
    await actionsDb.markFailed(db, actionId, err.message);
    throw new ExternalServiceError(err.message);
  }
}
```

If step 2 succeeds but step 3 fails (DB down), the action stays `approved`. The heartbeat detects this and retries the status update. No inconsistent state.

---

## Middleware

Three middleware registered globally on the Hono app. Execution order matters — listed in the order they run (outermost → innermost):

### Registration

```typescript
// app.ts
app.use('*', requestId());
app.use('*', requestLogger());
app.use('*', cors());
app.use('/api/*', authMiddleware());  // existing auth middleware
```

### 1. Request ID (`middleware/request-id.ts`)

Generates a unique ID per request. Sets it on the Hono context and the `X-Request-ID` response header. All downstream logging binds this ID for correlation.

```typescript
// middleware/request-id.ts
import { createMiddleware } from 'hono/factory';

export const requestId = () =>
  createMiddleware(async (c, next) => {
    const id = c.req.header('x-request-id') ?? crypto.randomUUID();
    c.set('requestId', id);
    c.header('X-Request-ID', id);
    await next();
  });
```

### 2. Request Logger (`middleware/request-logger.ts`)

Logs every request with method, path, status code, and duration. Uses the request ID from context. Skips `/health`.

```typescript
// middleware/request-logger.ts
import { createMiddleware } from 'hono/factory';
import { createLogger } from '../infra/logger';

export const requestLogger = () =>
  createMiddleware(async (c, next) => {
    if (c.req.path === '/health') return next();

    const start = Date.now();
    const log = createLogger({ requestId: c.get('requestId') });

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    const logFn = status >= 500 ? log.error : status >= 400 ? log.warn : log.info;
    logFn({ method: c.req.method, path: c.req.path, status, duration }, 'request');
  });
```

### 3. CORS (`middleware/cors.ts`)

Allows the Vite dev server and production frontend origin to make credentialed requests.

```typescript
// middleware/cors.ts
import { cors as honoCors } from 'hono/cors';

export const cors = () =>
  honoCors({
    origin: [
      'http://localhost:5173',   // Vite dev server
      process.env.FRONTEND_URL!, // Production
    ],
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
  });
```

Note: Hono has built-in CORS middleware — no extra dependency needed.

---

## Error Handling

### Exception Hierarchy

```typescript
// core/errors.ts

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
  }
}

export class ConflictError extends Error {}        // Duplicate email, duplicate bucket name
export class ValidationError extends Error {}      // Invalid state transition, bad input
export class ExternalServiceError extends Error {} // Gmail/Calendar/Drive API failure
```

### Error Flow by Layer

| Layer | Behavior |
|---|---|
| `db/` | No catching. Let Drizzle/Postgres errors bubble up. |
| `connectors/` | Catch API errors, wrap in `ExternalServiceError`. Rate limiter retries 429s before throwing. |
| `core/` | Catch DB errors and map to domain exceptions. Unique violation → `ConflictError`. No rows → `NotFoundError`. Invalid state transition → `ValidationError`. |
| `routes/` | Global Hono error handler maps domain exceptions to HTTP status codes. |
| `agents/` | Catch domain exceptions, return error context to orchestrator for user-facing messages. |

### Hono Error Handler

```typescript
// routes/error-handler.ts
app.onError((err, c) => {
  if (err instanceof NotFoundError)        return c.json({ error: err.message }, 404);
  if (err instanceof ValidationError)      return c.json({ error: err.message }, 400);
  if (err instanceof ConflictError)        return c.json({ error: err.message }, 409);
  if (err instanceof ExternalServiceError) return c.json({ error: err.message }, 502);

  logger.error({ err }, 'unhandled error');
  return c.json({ error: 'Internal server error' }, 500);
});
```

---

## Query Return Types

Types derived from Drizzle schema, re-exported from `shared/`:

```typescript
// db/schema.ts — source of truth
export const people = pgTable('people', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  // ...
});

// shared/types/people.ts — type-only re-export
import type { people } from '@assistant/backend/db/schema';

export type Person = typeof people.$inferSelect;
export type PersonInsert = typeof people.$inferInsert;
```

`db/` returns `Person`. `core/` works with `Person`. Frontend receives `Person`. No manual mapping, no drift.

---

## Soft Delete: People

`db/people.ts` defaults to excluding deleted records:

```typescript
// db/people.ts

// Default: active people only
export async function findByEmail(db: DB, email: string): Promise<Person | null> {
  const [row] = await db
    .select()
    .from(people)
    .where(and(eq(people.email, email), isNull(people.deletedAt)));
  return row ?? null;
}

// Explicit: include deleted (for re-proposal prevention)
export async function findByEmailIncludeDeleted(db: DB, email: string): Promise<Person | null> {
  const [row] = await db
    .select()
    .from(people)
    .where(eq(people.email, email));
  return row ?? null;
}

// Soft delete
export async function softDelete(db: DB, id: string): Promise<void> {
  await db.update(people).set({ deletedAt: new Date() }).where(eq(people.id, id));
}
```

When the agent proposes a new contact, `core/` checks `findByEmailIncludeDeleted` — if the person exists with `status: rejected` and `deleted_at` set, skip re-proposal.

---

## Connectors

### Interface/Adapter Pattern

Per the system spec, operations define interfaces. Provider-specific adapters implement them.

```typescript
// connectors/interfaces.ts

export interface EmailClient {
  readThread(threadId: string): Promise<ThreadContent>;
  sendEmail(params: SendEmailParams): Promise<SendResult>;
  searchThreads(query: string): Promise<ThreadSummary[]>;
}

export interface CalendarClient {
  getEvent(eventId: string): Promise<EventDetails>;
  createEvent(params: CreateEventParams): Promise<EventResult>;
  updateEvent(eventId: string, params: UpdateEventParams): Promise<EventResult>;
  cancelEvent(eventId: string): Promise<void>;
  listEvents(timeMin: Date, timeMax: Date): Promise<EventSummary[]>;
}

export interface DriveClient {
  getDocument(docId: string): Promise<DocumentContent>;
  createDocument(params: CreateDocParams): Promise<DocResult>;
  searchDocuments(query: string): Promise<DocSummary[]>;
}
```

### Singleton Pattern

Connectors are module-level singletons, initialized once at app startup. Any layer that needs a connector imports it directly — no parameter passing.

```typescript
// connectors/gmail.ts
import { rateLimiter } from './rate-limiter';

class GmailClientImpl implements EmailClient {
  private auth: OAuth2Client | null = null;

  initialize(auth: OAuth2Client) {
    this.auth = auth;
  }

  async readThread(threadId: string): Promise<ThreadContent> {
    return rateLimiter.execute(() =>
      google.gmail({ version: 'v1', auth: this.auth! })
        .users.threads.get({ userId: 'me', id: threadId })
    );
  }
}

export const emailClient: EmailClient = new GmailClientImpl();
```

```typescript
// connectors/index.ts — single import point
export { emailClient } from './gmail';
export { calendarClient } from './google-calendar';
export { driveClient } from './google-drive';
```

Initialization happens once at app startup after OAuth tokens are available:

```typescript
// app.ts
import { emailClient, calendarClient, driveClient } from './connectors';

// After OAuth setup:
emailClient.initialize(oauthClient);
calendarClient.initialize(oauthClient);
driveClient.initialize(oauthClient);
```

For testing, each connector module exports a `setInstance` function (or use module mocking) to swap in stubs returning static JSON fixtures.

---

## Rate Limiting and Retry

Shared rate limiter in `connectors/`. All Google API calls go through it.

```typescript
// connectors/rate-limiter.ts

export class RateLimiter {
  constructor(private options: {
    maxConcurrent: number;   // Max parallel requests
    retries: number;         // Max retry attempts on 429
    baseDelay: number;       // Starting backoff delay (ms), default 1000
  }) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireSlot();
    try {
      return await this.executeWithRetry(fn);
    } finally {
      this.releaseSlot();
    }
  }

  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!this.isRateLimited(err) || attempt === this.options.retries) throw err;
        await this.backoff(attempt);
      }
    }
    throw new Error('Unreachable');
  }

  private async backoff(attempt: number): Promise<void> {
    const delay = this.options.baseDelay * Math.pow(2, attempt);
    const jitter = delay * 0.5 * Math.random();
    await new Promise(r => setTimeout(r, delay + jitter));
  }
}
```

Partial failure support per system spec: if one API call is rate-limited, others continue. The rate limiter retries transparently. If retries are exhausted, the connector throws `ExternalServiceError` and `core/` decides how to handle (skip, retry on next heartbeat, or surface to user).

---

## Infra

### App Logger

Structured, context-aware logger used by all layers. Single import, consistent format.

```typescript
// infra/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
});

export type Logger = typeof logger;

// Create child loggers with bound context
export function createLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}
```

#### Usage by Layer

Every layer imports from `infra/logger`. Child loggers bind the relevant context so log lines are traceable:

```typescript
// routes/threads.ts — bind per-request context
app.use('*', async (c, next) => {
  const requestLogger = createLogger({
    requestId: c.req.header('x-request-id') ?? crypto.randomUUID(),
    path: c.req.path,
  });
  c.set('logger', requestLogger);
  await next();
});

// core/threads.ts — bind per-operation context
export async function investigateThread(db: DB, threadId: string, plan: InvestigationPlan) {
  const log = createLogger({ op: 'investigateThread', threadId });
  log.info({ peopleCount: plan.newPeople.length }, 'starting investigation');
  // ...
}

// agents/orchestrator.ts — bind per-agent context
const log = createLogger({ caller: 'agent', skill: 'sort-inbox' });

// db/people.ts — use root logger for query-level tracing (debug only)
import { logger } from '../infra/logger';
logger.debug({ email }, 'findByEmail');
```

#### Log Levels

| Level | Use |
|---|---|
| `error` | Unrecoverable failures, unhandled exceptions |
| `warn` | Degraded state: retry exhausted, partial failure, external API error that was handled |
| `info` | Operation start/complete, state transitions (action approved → executed), heartbeat ticks |
| `debug` | DB queries, connector request/response, agent tool calls |

#### Why Pino

- Structured JSON output by default (machine-parseable in production)
- `pino-pretty` for readable dev output
- Child loggers for zero-cost context binding
- Fast — no blocking I/O in the log path

### WebSocket

Connection manager for pushing real-time updates to the frontend. Detailed in the UI spec (to be written). Responsibilities:

- Maintain active connections per session
- Broadcast state changes from `core/` (new thread sorted, action status change, task created)
- Handle reconnection and keepalive pings
