# API Design

## Overview

HTTP + WebSocket API served by Hono. All routes under `/api/*` require auth middleware. Routes parse requests, call exactly one core function, and return responses. No business logic in route handlers.

**Middleware stack:** request-id → request-logger → cors → auth (see [backend_architecture.md](backend_architecture.md)).

**Error handling:** Global `app.onError` maps domain exceptions to HTTP status codes (see [backend_architecture.md](backend_architecture.md#error-handling)).

**Import rules:** Route files import from `core/`, `infra/`, `db/schema` (types only), and `shared/`. Never from `db/` query functions, `drizzle-orm`, or `connectors/`.

---

## Conventions

### Base URL

All endpoints prefixed with `/api`.

### Response Shapes

```typescript
// Single entity
{ data: T }

// List
{ data: T[], total: number, cursor?: string }

// Success with no body
204 No Content

// Error (all error responses)
{ error: string }
```

### Pagination

Cursor-based pagination on all list endpoints. Query params:

| Param | Type | Default | Description |
|---|---|---|---|
| `cursor` | `string` | — | Opaque cursor from previous response |
| `limit` | `number` | `50` | Items per page (max 100) |

The cursor encodes the sort column value + ID of the last item. Server decodes, queries `WHERE (sort_col, id) > (cursor_val, cursor_id)`, returns next page. Response includes `cursor` only if more items exist.

### Request Validation

All request bodies and query params validated with Zod schemas defined in `packages/shared/src/schemas/`. Frontend imports the same schemas for client-side validation.

```typescript
// shared/src/schemas/threads.ts
import { z } from 'zod';

export const ListThreadsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  bucketId: z.string().uuid().optional(),
});

export type ListThreadsQuery = z.infer<typeof ListThreadsQuery>;
```

Route handlers validate before calling core:

```typescript
// routes/threads.ts
app.get('/api/threads', async (c) => {
  const query = ListThreadsQuery.parse(c.req.query());
  const result = await threadCore.list(db, query);
  return c.json({ data: result.items, total: result.total, cursor: result.cursor });
});
```

Zod parse errors are caught by the global error handler and returned as `400 { error: string }`.

### Response Types

Response types use Drizzle `$inferSelect` types re-exported from `shared/types/`. See [backend_architecture.md](backend_architecture.md#query-return-types) for the pattern.

---

## Auth Routes

**File:** `routes/auth.ts`

These routes are public — outside the `/api/*` auth middleware scope.

| Method | Path | Core Function | Description |
|---|---|---|---|
| `GET` | `/auth/google` | `auth.getAuthUrl()` | Redirect to Google OAuth consent screen |
| `GET` | `/auth/google/callback` | `auth.handleCallback()` | OAuth callback — exchanges code for tokens, sets session |
| `POST` | `/auth/logout` | `auth.logout()` | Clear session |
| `GET` | `/auth/status` | `auth.getStatus()` | Check if authenticated |

### `GET /auth/google`

**Response:** `302` redirect to Google OAuth URL.

### `GET /auth/google/callback`

**Query params:**

```typescript
const OAuthCallbackQuery = z.object({
  code: z.string(),
  state: z.string().optional(),
});
```

**Response:** `302` redirect to frontend (with session cookie set).

### `POST /auth/logout`

**Response:** `204 No Content`.

### `GET /auth/status`

**Response:**
```typescript
{ data: { authenticated: boolean, email?: string } }
```

---

## Health

**Public route** — no auth required.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{ status: 'ok' }` |

---

## Threads

**File:** `routes/threads.ts`

| Method | Path | Core Function | Description |
|---|---|---|---|
| `GET` | `/api/threads` | `threadCore.list()` | List threads, optionally filtered by bucket |
| `GET` | `/api/threads/:id` | `threadCore.getById()` | Get single thread with classification |
| `PATCH` | `/api/threads/:id` | `threadCore.update()` | Move thread to a different bucket |
| `POST` | `/api/threads/sort` | `orchestrator.sortInbox()` | Trigger inbox sort (agent skill — LLM classification) |

### `GET /api/threads`

**Query:**
```typescript
const ListThreadsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  bucketId: z.string().uuid().optional(),
});
```

**Response:** `200`
```typescript
{
  data: Thread[],
  total: number,
  cursor?: string
}
```

### `GET /api/threads/:id`

**Response:** `200`
```typescript
{ data: Thread }
```

**Errors:** `404` if not found.

### `PATCH /api/threads/:id`

**Body:**
```typescript
const UpdateThreadBody = z.object({
  bucketId: z.string().uuid(),
});
```

**Response:** `200`
```typescript
{ data: Thread }
```

**Errors:** `404` if thread not found. `404` if bucket not found.

### `POST /api/threads/sort`

Triggers the Sort Inbox skill. Returns immediately — results arrive via WebSocket.

**Response:** `202`
```typescript
{ data: { jobId: string } }
```

---

## Buckets

**File:** `routes/buckets.ts`

| Method | Path | Core Function | Description |
|---|---|---|---|
| `GET` | `/api/buckets` | `bucketCore.list()` | List all buckets in sort order |
| `POST` | `/api/buckets` | `bucketCore.create()` | Create bucket (triggers re-sort) |
| `PATCH` | `/api/buckets/:id` | `bucketCore.update()` | Update name, description, or sort order |
| `DELETE` | `/api/buckets/:id` | `bucketCore.remove()` | Delete bucket (re-sorts threads out first) |

### `GET /api/buckets`

No pagination — buckets are a small, fixed set.

**Response:** `200`
```typescript
{ data: Bucket[] }
```

### `POST /api/buckets`

**Body:**
```typescript
const CreateBucketBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  sortOrder: z.number().int().optional(),
});
```

**Response:** `201`
```typescript
{ data: Bucket }
```

Creating a bucket triggers a re-sort of all threads (via Re-sort Inbox skill). The re-sort runs async — progress via WebSocket.

**Errors:** `409` if name already exists.

### `PATCH /api/buckets/:id`

**Body:**
```typescript
const UpdateBucketBody = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
});
```

**Response:** `200`
```typescript
{ data: Bucket }
```

**Errors:** `404` if not found. `409` if name conflicts.

### `DELETE /api/buckets/:id`

Threads in this bucket are re-sorted into remaining buckets (transactional).

**Response:** `204 No Content`.

**Errors:** `404` if not found.

---

## Tasks

**File:** `routes/tasks.ts`

| Method | Path | Core Function | Description |
|---|---|---|---|
| `GET` | `/api/tasks` | `taskCore.list()` | List tasks with filters |
| `GET` | `/api/tasks/:id` | `taskCore.getById()` | Get single task |
| `POST` | `/api/tasks` | `taskCore.create()` | Create a task (user-created) |
| `PATCH` | `/api/tasks/:id` | `taskCore.update()` | Update task fields |
| `POST` | `/api/tasks/:id/transition` | `taskCore.transition()` | Advance task status |

### `GET /api/tasks`

**Query:**
```typescript
const ListTasksQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  status: z.enum(['proposed', 'confirmed', 'in_progress', 'complete_proposed', 'complete', 'overdue', 'rejected']).optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  delegatedTo: z.string().uuid().optional(),
  dueBefore: z.coerce.date().optional(),
});
```

**Response:** `200`
```typescript
{
  data: Task[],
  total: number,
  cursor?: string
}
```

### `GET /api/tasks/:id`

**Response:** `200`
```typescript
{ data: Task }
```

**Errors:** `404`.

### `POST /api/tasks`

**Body:**
```typescript
const CreateTaskBody = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).default('normal'),
  dueDate: z.coerce.date().optional(),
  delegatedTo: z.string().uuid().optional(),
  sourceType: z.enum(['thread', 'event', 'user']).optional(),
  sourceId: z.string().uuid().optional(),
});
```

User-created tasks start as `confirmed` (skip `proposed`).

**Response:** `201`
```typescript
{ data: Task }
```

### `PATCH /api/tasks/:id`

**Body:**
```typescript
const UpdateTaskBody = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  delegatedTo: z.string().uuid().nullable().optional(),
});
```

**Response:** `200`
```typescript
{ data: Task }
```

**Errors:** `404`.

### `POST /api/tasks/:id/transition`

**Body:**
```typescript
const TransitionTaskBody = z.object({
  to: z.enum(['confirmed', 'in_progress', 'complete_proposed', 'complete', 'rejected', 'overdue']),
});
```

Core validates the transition is legal per the status flow.

**Response:** `200`
```typescript
{ data: Task }
```

**Errors:** `404`. `400` if transition is invalid.

---

## Events

**File:** `routes/events.ts`

| Method | Path | Core Function | Description |
|---|---|---|---|
| `GET` | `/api/events` | `eventCore.list()` | List events in a date range |
| `GET` | `/api/events/:id` | `eventCore.getById()` | Get single event with brief |
| `GET` | `/api/events/:id/brief` | `eventCore.getBrief()` | Get just the meeting brief |
| `POST` | `/api/events/:id/prep` | `orchestrator.prepMeeting()` | Trigger meeting prep (agent skill — LLM brief generation) |

### `GET /api/events`

**Query:**
```typescript
const ListEventsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  from: z.coerce.date(),
  to: z.coerce.date(),
});
```

**Response:** `200`
```typescript
{
  data: Event[],
  total: number,
  cursor?: string
}
```

### `GET /api/events/:id`

**Response:** `200`
```typescript
{ data: Event }
```

**Errors:** `404`.

### `GET /api/events/:id/brief`

Returns the generated meeting brief for this event.

**Response:** `200`
```typescript
{
  data: {
    participants: { personId: string, name: string, role: string, context: string }[],
    relatedThreads: { threadId: string, subject: string, snippet: string }[],
    relatedDocuments: { googleDocId: string, title: string, url: string }[],
    summary: string,
    suggestedAgenda: string[],
  }
}
```

**Errors:** `404` if event not found. `404` if no brief generated yet.

### `POST /api/events/:id/prep`

Triggers the Prep Meeting skill. Returns immediately — results via WebSocket.

**Response:** `202`
```typescript
{ data: { jobId: string } }
```

**Errors:** `404`.

---

## People

**File:** `routes/people.ts`

| Method | Path | Core Function | Description |
|---|---|---|---|
| `GET` | `/api/people` | `peopleCore.list()` | List people with filters |
| `GET` | `/api/people/:id` | `peopleCore.getById()` | Get single person |
| `POST` | `/api/people` | `peopleCore.create()` | Create a person (user-created) |
| `PATCH` | `/api/people/:id` | `peopleCore.update()` | Update person details |
| `DELETE` | `/api/people/:id` | `peopleCore.remove()` | Soft-delete a person |
| `POST` | `/api/people/:id/confirm` | `peopleCore.confirm()` | Confirm a proposed person |
| `POST` | `/api/people/:id/reject` | `peopleCore.reject()` | Reject a proposed person |

### `GET /api/people`

**Query:**
```typescript
const ListPeopleQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  status: z.enum(['proposed', 'confirmed', 'rejected']).optional(),
  relationshipType: z.enum([
    'colleague', 'client', 'vendor', 'reports_to_me',
    'i_report_to', 'external', 'personal', 'other'
  ]).optional(),
  search: z.string().optional(),
});
```

`search` filters by name or email (case-insensitive prefix match).

**Response:** `200`
```typescript
{
  data: Person[],
  total: number,
  cursor?: string
}
```

### `GET /api/people/:id`

**Response:** `200`
```typescript
{ data: Person }
```

**Errors:** `404`.

### `POST /api/people`

**Body:**
```typescript
const CreatePersonBody = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  role: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  relationshipType: z.enum([
    'colleague', 'client', 'vendor', 'reports_to_me',
    'i_report_to', 'external', 'personal', 'other'
  ]),
  context: z.string().max(2000).optional(),
  notes: z.string().max(5000).optional(),
});
```

User-created people start as `confirmed`.

**Response:** `201`
```typescript
{ data: Person }
```

**Errors:** `409` if email already exists.

### `PATCH /api/people/:id`

**Body:**
```typescript
const UpdatePersonBody = z.object({
  name: z.string().min(1).max(200).optional(),
  role: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  relationshipType: z.enum([
    'colleague', 'client', 'vendor', 'reports_to_me',
    'i_report_to', 'external', 'personal', 'other'
  ]).optional(),
  context: z.string().max(2000).optional(),
  notes: z.string().max(5000).optional(),
});
```

**Response:** `200`
```typescript
{ data: Person }
```

**Errors:** `404`.

### `DELETE /api/people/:id`

Soft-delete. Sets `deletedAt` timestamp.

**Response:** `204 No Content`.

**Errors:** `404`.

### `POST /api/people/:id/confirm`

Transitions status from `proposed` → `confirmed`.

**Response:** `200`
```typescript
{ data: Person }
```

**Errors:** `404`. `400` if not in `proposed` status.

### `POST /api/people/:id/reject`

Transitions status from `proposed` → `rejected`, then soft-deletes.

**Response:** `200`
```typescript
{ data: Person }
```

**Errors:** `404`. `400` if not in `proposed` status.

---

## Actions

**File:** `routes/actions.ts`

| Method | Path | Core Function | Description |
|---|---|---|---|
| `GET` | `/api/actions` | `actionCore.list()` | List actions with filters |
| `GET` | `/api/actions/:id` | `actionCore.getById()` | Get single action with full detail |
| `POST` | `/api/actions/:id/approve` | `actionCore.approve()` | Approve a proposed action |
| `POST` | `/api/actions/:id/reject` | `actionCore.reject()` | Reject a proposed action |

### `GET /api/actions`

**Query:**
```typescript
const ListActionsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  status: z.enum(['proposed', 'approved', 'executed', 'rejected', 'expired', 'failed']).optional(),
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  initiatedBy: z.enum(['agent', 'user']).optional(),
});
```

**Response:** `200`
```typescript
{
  data: Action[],
  total: number,
  cursor?: string
}
```

### `GET /api/actions/:id`

**Response:** `200`
```typescript
{ data: Action }
```

The `input` and `output` JSONB fields contain operation-specific data (e.g., draft email content in `input`, send result in `output`).

**Errors:** `404`.

### `POST /api/actions/:id/approve`

Approves the action and triggers execution. For side-effect operations (email.send, calendar.create, etc.), execution happens asynchronously — the action transitions through `approved` → `executed` or `approved` → `failed`.

**Body (optional):**
```typescript
const ApproveActionBody = z.object({
  editedInput: z.record(z.unknown()).optional(),
}).optional();
```

`editedInput` allows the user to modify the action's parameters before approval (e.g., edit a draft email). Merged over the original `input`.

**Response:** `200`
```typescript
{ data: Action }
```

The returned action has `status: 'approved'`. Execution status updates arrive via WebSocket.

**Errors:** `404`. `400` if not in `proposed` status.

### `POST /api/actions/:id/reject`

**Body (optional):**
```typescript
const RejectActionBody = z.object({
  reason: z.string().max(1000).optional(),
}).optional();
```

Rejection reason feeds into preferences learning.

**Response:** `200`
```typescript
{ data: Action }
```

**Errors:** `404`. `400` if not in `proposed` status.

### Action Approval Flow — Full Lifecycle

The key UX flow from the API perspective:

1. **Agent proposes** — Agent creates an action via `actionCore.create()` with `status: 'proposed'`. WebSocket emits `action:proposed` to frontend.

2. **Frontend displays** — Action card shown to user with operation details from `input` (e.g., draft email body, calendar event details).

3. **User reviews** — User can view full action detail via `GET /api/actions/:id`.

4. **User decides:**
   - `POST /api/actions/:id/approve` — optionally with `editedInput` to modify before executing.
   - `POST /api/actions/:id/reject` — optionally with `reason`.

5. **Execution (on approve):**
   - Core marks action as `approved`.
   - Core dispatches the operation (e.g., sends email via connector).
   - On success: marks `executed`, sets `output` and `executed_at`. WebSocket emits `action:executed`.
   - On failure: marks `failed`, sets `error`. WebSocket emits `action:failed`.

6. **Preference learning** — Approval/rejection patterns are analyzed to update preference files.

---

## Briefings

**File:** `routes/briefings.ts`

| Method | Path | Core Function | Description |
|---|---|---|---|
| `GET` | `/api/briefings/today` | `briefingCore.getToday()` | Get today's briefing if it exists |

### `GET /api/briefings/today`

Returns the most recent briefing for today. If no briefing has been generated yet, returns `404`.

The response returns the stored `BriefingContent` JSONB directly — IDs + summary strings, not full hydrated entities. The frontend fetches full entity details via their respective endpoints when the user drills in.

**Response:** `200`
```typescript
{
  data: {
    id: string,
    date: string,
    generatedAt: string,
    content: BriefingContent,  // See shared/schemas/briefing.ts
  }
}
```

**Errors:** `404` if no briefing generated today.

---

## Agent

**File:** `routes/agent.ts`

Routes for agent interaction. These are the only routes that import from `agents/` — all other routes go through `core/`.

| Method | Path | Handler | Description |
|---|---|---|---|
| `POST` | `/api/agent/chat` | `orchestrator.sendMessage()` | Send a message to the orchestrator |
| `POST` | `/api/agent/start-day` | `orchestrator.startDay()` | Trigger daily briefing generation |

### `POST /api/agent/chat`

**Body:**
```typescript
const SendMessageBody = z.object({
  message: z.string().min(1).max(10000),
});
```

Sends the user's message to the orchestrator agent. The response streams back via WebSocket (see `conversation:chunk` event below).

**Response:** `202`
```typescript
{ data: { conversationId: string } }
```

### `POST /api/agent/start-day`

Triggers the Daily Briefing skill which orchestrates Sort Inbox + Prep Meeting + task queries. Returns immediately — the briefing is assembled asynchronously and delivered via WebSocket. This is the "Start Day" button.

**Response:** `202`
```typescript
{ data: { jobId: string } }
```

If a briefing is already being generated, returns `409` with `{ error: "Briefing generation already in progress" }`.

---

## WebSocket Events

**Endpoint:** `ws://host/ws`

Connection established after authentication. The server sends JSON messages with a `type` field. The client does not send messages over WebSocket (uses HTTP endpoints instead).

### Event Format

```typescript
{
  type: string,
  payload: unknown,
  timestamp: string,    // ISO 8601
}
```

### Event Types

#### Thread Events

| Type | Payload | When |
|---|---|---|
| `thread:sorted` | `{ threadId: string, bucketId: string, classification: Classification }` | Thread classified and assigned to bucket |
| `thread:updated` | `{ thread: Thread }` | Thread metadata updated |
| `threads:sort_complete` | `{ total: number, changed: number }` | Inbox sort skill finished |
| `threads:resort_complete` | `{ total: number, changed: number }` | Re-sort after bucket change finished |

#### Action Events

| Type | Payload | When |
|---|---|---|
| `action:proposed` | `{ action: Action }` | Agent proposed a new action |
| `action:executed` | `{ action: Action }` | Approved action executed successfully |
| `action:failed` | `{ action: Action, error: string }` | Action execution failed |

#### Task Events

| Type | Payload | When |
|---|---|---|
| `task:created` | `{ task: Task }` | New task created (by agent or user) |
| `task:updated` | `{ task: Task }` | Task status or fields changed |
| `task:overdue` | `{ task: Task }` | Task flagged as overdue by heartbeat |

#### Event (Calendar) Events

| Type | Payload | When |
|---|---|---|
| `event:brief_ready` | `{ eventId: string, brief: EventBrief }` | Meeting prep complete |
| `event:updated` | `{ event: Event }` | Calendar event changed |
| `event:post_processed` | `{ eventId: string, actionItems: Task[] }` | Post-meeting processing complete |

#### People Events

| Type | Payload | When |
|---|---|---|
| `person:proposed` | `{ person: Person }` | Agent proposed a new contact |

#### Briefing Events

| Type | Payload | When |
|---|---|---|
| `briefing:progress` | `{ step: string, percent: number }` | Briefing generation progress |
| `briefing:ready` | `{ briefingId: string }` | Briefing fully generated — client should fetch via GET |

#### Conversation Events

| Type | Payload | When |
|---|---|---|
| `conversation:chunk` | `{ conversationId: string, delta: string }` | Streaming text from orchestrator |
| `conversation:complete` | `{ conversationId: string }` | Orchestrator finished responding |
| `conversation:action` | `{ conversationId: string, action: Action }` | Orchestrator proposed an action during conversation |

#### System Events

| Type | Payload | When |
|---|---|---|
| `heartbeat:tick` | `{ timestamp: string, checks: string[] }` | Heartbeat ran — lists what was checked |
| `system:error` | `{ error: string, context?: string }` | System-level error (auth expired, connector down) |

---

## Zod Schema Index

All schemas live in `packages/shared/src/schemas/`, one file per entity.

| File | Schemas |
|---|---|
| `threads.ts` | `ListThreadsQuery`, `UpdateThreadBody` |
| `buckets.ts` | `CreateBucketBody`, `UpdateBucketBody` |
| `tasks.ts` | `ListTasksQuery`, `CreateTaskBody`, `UpdateTaskBody`, `TransitionTaskBody` |
| `events.ts` | `ListEventsQuery` |
| `people.ts` | `ListPeopleQuery`, `CreatePersonBody`, `UpdatePersonBody` |
| `actions.ts` | `ListActionsQuery`, `ApproveActionBody`, `RejectActionBody` |
| `briefings.ts` | — (no request bodies) |
| `agent.ts` | `SendMessageBody` |
| `common.ts` | `PaginationQuery` (base cursor + limit, extended by list schemas) |

### Base Pagination Schema

```typescript
// shared/src/schemas/common.ts
import { z } from 'zod';

export const PaginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});
```

Entity-specific list schemas extend this:

```typescript
// shared/src/schemas/tasks.ts
export const ListTasksQuery = PaginationQuery.extend({
  status: z.enum([...]).optional(),
  priority: z.enum([...]).optional(),
  // ...
});
```

---

## Route → Core Function Mapping

Complete mapping of every route handler to its core function call.

| Route | Core Function |
|---|---|
| `GET /api/threads` | `threadCore.list(db, query)` |
| `GET /api/threads/:id` | `threadCore.getById(db, id)` |
| `PATCH /api/threads/:id` | `threadCore.update(db, id, body)` |
| `POST /api/threads/sort` | `orchestrator.sortInbox(db)` — agent route |
| `GET /api/buckets` | `bucketCore.list(db)` |
| `POST /api/buckets` | `bucketCore.create(db, body)` |
| `PATCH /api/buckets/:id` | `bucketCore.update(db, id, body)` |
| `DELETE /api/buckets/:id` | `bucketCore.remove(db, id)` |
| `GET /api/tasks` | `taskCore.list(db, query)` |
| `GET /api/tasks/:id` | `taskCore.getById(db, id)` |
| `POST /api/tasks` | `taskCore.create(db, body)` |
| `PATCH /api/tasks/:id` | `taskCore.update(db, id, body)` |
| `POST /api/tasks/:id/transition` | `taskCore.transition(db, id, body.to)` |
| `GET /api/events` | `eventCore.list(db, query)` |
| `GET /api/events/:id` | `eventCore.getById(db, id)` |
| `GET /api/events/:id/brief` | `eventCore.getBrief(db, id)` |
| `POST /api/events/:id/prep` | `orchestrator.prepMeeting(db, id)` — agent route |
| `GET /api/people` | `peopleCore.list(db, query)` |
| `GET /api/people/:id` | `peopleCore.getById(db, id)` |
| `POST /api/people` | `peopleCore.create(db, body)` |
| `PATCH /api/people/:id` | `peopleCore.update(db, id, body)` |
| `DELETE /api/people/:id` | `peopleCore.remove(db, id)` |
| `POST /api/people/:id/confirm` | `peopleCore.confirm(db, id)` |
| `POST /api/people/:id/reject` | `peopleCore.reject(db, id)` |
| `GET /api/actions` | `actionCore.list(db, query)` |
| `GET /api/actions/:id` | `actionCore.getById(db, id)` |
| `POST /api/actions/:id/approve` | `actionCore.approve(db, id, body?)` |
| `POST /api/actions/:id/reject` | `actionCore.reject(db, id, body?)` |
| `GET /api/briefings/today` | `briefingCore.getToday(db)` |
| `POST /api/agent/chat` | `orchestrator.sendMessage(body)` — agent route |
| `POST /api/agent/start-day` | `orchestrator.startDay(db)` — agent route |

---

## Public vs. Protected Routes

| Route Pattern | Auth Required |
|---|---|
| `GET /health` | No |
| `GET /auth/*` | No |
| `POST /auth/logout` | No |
| `GET /api/*` | Yes |
| `POST /api/*` | Yes |
| `PATCH /api/*` | Yes |
| `DELETE /api/*` | Yes |
| `ws://host/ws` | Yes (session cookie validated on connection upgrade) |

Auth middleware is applied via `app.use('/api/*', authMiddleware())`. See [backend_architecture.md](backend_architecture.md) for middleware implementation.
