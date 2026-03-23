# Backend Patterns

## Layer Architecture

```
Routes (routes.ts)  →  Query Functions (queries.ts)  →  PostgreSQL (Drizzle)
                              ↑
MCP Tools (tools.ts) ─┤
                      └→  Google Connectors (google/*.ts)
```

Routes and MCP tools both delegate to the same queries and connectors. Never skip layers.

## Drizzle ORM Patterns

### Schema Definition (schema.ts)

All tables include `user_id` for multi-tenancy:

```typescript
import { pgTable, uuid, text, timestamp, integer, uniqueIndex } from 'drizzle-orm/pg-core';

export const buckets = pgTable('buckets', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  description: text('description').notNull(),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('buckets_user_id_name_idx').on(table.user_id, table.name),
]);
```

### Query Functions (queries.ts)

All queries take `userId` as the first parameter:

```typescript
export async function listBuckets(userId: string) {
  return db.select().from(buckets).where(eq(buckets.user_id, userId)).orderBy(buckets.sort_order);
}

export async function createBucket(userId: string, name: string, description: string) {
  const [row] = await db.insert(buckets).values({ user_id: userId, name, description }).returning();
  return row;
}

export async function updateBucket(
  userId: string, id: string,
  updates: { name?: string; description?: string; sort_order?: number },
) {
  const [row] = await db.update(buckets).set(updates)
    .where(and(eq(buckets.id, id), eq(buckets.user_id, userId))).returning();
  if (!row) throw new AppError(`Bucket not found: ${id}`, 404, { userFacing: true });
  return row;
}
```

### Key Rules

- All queries go through `queries.ts` — never raw SQL or direct `db` access in routes/tools
- Always use `.returning()` for INSERT/UPDATE to get the result
- Throw `AppError` with appropriate status for missing records, never return null silently
- Use Drizzle's type-safe query builder, never string concatenation
- All queries scope by `userId` — never return another user's data

## REST Route Patterns

Routes are thin HTTP handlers. They extract `userId`, validate input with Zod, call queries/connectors, and return JSON:

```typescript
apiRoutes.get('/buckets', async (c) => {
  const userId = c.get('userId') as string;
  const buckets = await queries.listBucketsWithThreads(userId);
  return c.json(buckets);
});

apiRoutes.post('/buckets', async (c) => {
  const userId = c.get('userId') as string;
  const body = createBucketSchema.parse(await c.req.json());
  const bucket = await queries.createBucket(userId, body.name, body.description);
  return c.json(bucket, 201);
});
```

## MCP Tool Patterns

Tools use Claude Agent SDK's `createSdkMcpServer` and `tool()`. Handlers are organized in a `handlers` object with action-based switches:

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export const handlers = {
  buckets: async (userId: string, params: { action: 'list' | 'create' | ... }) => {
    switch (params.action) {
      case 'list': return { content: [{ type: 'text', text: JSON.stringify(await queries.listBuckets(userId)) }] };
      case 'create': { /* ... */ }
    }
  },
};

export function createCustomMcpServer(userId: string) {
  return createSdkMcpServer({
    name: 'assistant-tools',
    version: '1.0.0',
    tools: [
      tool('buckets', 'Manage email buckets...', {
        action: z.enum(['list', 'create', 'update', 'delete', 'assign']),
        id: z.string().optional(),
        // ...
      }, (params) => handlers.buckets(userId, params)),
    ],
  });
}
```

Tool error responses use a helper that returns `{ isError: true }`:

```typescript
function err(message: string) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}
```

## Google Connector Patterns

Thin wrappers around googleapis. They receive an `OAuth2Client` (from `withUserTokens`), not a raw auth client:

```typescript
export async function searchThreads(auth: OAuth2Client, query: string, maxResults: number): Promise<ThreadSummary[]> {
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.threads.list({ userId: 'me', q: query, maxResults });
  const threads = (res.data.threads ?? []).map((t) => ({ ... }));
  return threads;
}
```

No business logic in connectors. They translate between our types and the googleapis SDK.

## WebSocket Protocol

```typescript
// Frontend → Backend
{ type: 'chat', content: string }           // user message (validated with Zod)

// Backend → Frontend
{ type: 'text_delta', content: string }     // partial token (only for simple non-tool responses)
{ type: 'text_done', content: string }      // full response when stream completes
{ type: 'tool_status', toolName: string, displayName: string }  // agent called a tool
{ type: 'conversation_updated', conversationId: string, title: string }  // title auto-set on first message
{ type: 'error', message: string }          // error (validation, agent limit, missing conversation)
```

The agent uses `streamQuery()` which wraps the Agent SDK's `query()` generator. It forwards streaming events over the WebSocket and persists messages to the database.

## Error Handling

A single `AppError` class with status code and `userFacing` flag. Caught at route level by `app.onError`:

```typescript
// src/server/exceptions.ts
export class AppError extends Error {
  public readonly userFacing: boolean;
  constructor(
    message: string,
    public readonly status: number = 500,
    options?: ErrorOptions & { userFacing?: boolean },
  ) {
    super(message, options);
    this.name = 'AppError';
    this.userFacing = options?.userFacing ?? false;
  }
}

// src/server/index.ts
app.onError((err, c) => {
  if (err instanceof ZodError) {
    console.error('Validation failed', { issues: err.issues });
    return c.json({ error: 'Validation failed', issues: err.issues }, 400);
  }
  if (err instanceof AppError) {
    console.error(err.message, { status: err.status, cause: err.cause });
    const message = err.userFacing ? err.message : 'Internal server error';
    return c.json({ error: message }, err.status as ContentfulStatusCode);
  }
  console.error('Unhandled error', { error: err });
  return c.json({ error: 'Internal server error' }, 500);
});
```

Non-`userFacing` errors return a generic message to the client; details stay in server logs.

## Authentication

1. Google OAuth for both login and API access (single consent flow with all scopes)
2. JWT session cookie (30 days, httpOnly, secure, sameSite=Strict)
3. CSRF protection — HMAC of session JWT, checked on state-changing methods (POST/PUT/PATCH/DELETE)
4. Google tokens stored in `google_tokens` Postgres table, **encrypted** with `ENCRYPTION_KEY`
5. `googleapis` auto-refreshes tokens; backend re-persists via `tokens` event listener
6. Per-request auth clients created by `withUserTokens(userId)` — decrypts stored tokens and wires up refresh persistence

## Rules Summary

- Routes contain NO business logic — delegate to query functions
- Routes NEVER access `db` directly — use queries.ts
- MCP tools and REST routes share the same queries and connectors
- Google connectors have NO business logic
- All queries scope by `userId` — multi-tenancy is enforced at the query layer
- All methods are async
- No fallbacks or silent defaults
