# Backend Patterns

## Layer Architecture

```
Routes (routes.ts)  →  Query Functions (queries.ts)  →  PostgreSQL (Drizzle)
                              ↑
MCP Tools (tools.ts)  →  Google Connectors (google/*.ts)
```

Routes and MCP tools both delegate to the same queries and connectors. Never skip layers.

## Drizzle ORM Patterns

### Schema Definition (schema.ts)

```typescript
import { pgTable, uuid, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';

export const buckets = pgTable('buckets', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  sortOrder: integer('sort_order').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### Query Functions (queries.ts)

```typescript
export async function getBuckets(): Promise<Bucket[]> {
  return db.select().from(buckets).orderBy(buckets.sortOrder);
}

export async function createBucket(data: NewBucket): Promise<Bucket> {
  const [bucket] = await db.insert(buckets).values(data).returning();
  return bucket;
}

export async function updateBucket(id: string, data: Partial<NewBucket>): Promise<Bucket> {
  const [bucket] = await db.update(buckets).set(data).where(eq(buckets.id, id)).returning();
  if (!bucket) throw new NotFoundError(`Bucket ${id} not found`);
  return bucket;
}
```

### Key Rules

- All queries go through `queries.ts` — never raw SQL or direct `db` access in routes/tools
- Always use `.returning()` for INSERT/UPDATE to get the result
- Throw `NotFoundError` for missing records, never return null silently
- Use Drizzle's type-safe query builder, never string concatenation

## REST Route Patterns

Routes are thin HTTP handlers:

```typescript
app.get('/api/buckets', async (c) => {
  const buckets = await getBucketsWithThreads();
  return c.json(buckets);
});

app.post('/api/buckets', async (c) => {
  const body = await c.req.json();
  const bucket = await createBucket(body);
  return c.json(bucket, 201);
});
```

## MCP Tool Patterns

Tools wrap the same queries and connectors:

```typescript
const tools = [
  {
    name: 'bucket_manage',
    description: 'List, create, update, delete buckets',
    inputSchema: { /* ... */ },
    handler: async (input) => {
      switch (input.action) {
        case 'list': return await getBuckets();
        case 'create': return await createBucket(input.params);
      }
    }
  },
];
```

## Google Connector Patterns

Thin wrappers around googleapis:

```typescript
export async function listThreads(params: ListThreadsParams) {
  const gmail = google.gmail({ version: 'v1', auth: getAuthClient() });
  const res = await gmail.users.threads.list({
    userId: 'me',
    q: params.query,
    maxResults: params.maxResults,
  });
  return res.data.threads ?? [];
}
```

No business logic in connectors. They translate between our types and the googleapis SDK.

## WebSocket Protocol

```typescript
// Frontend → Backend
{ type: 'chat', content: string }
{ type: 'approve' }
{ type: 'reject' }

// Backend → Frontend
{ type: 'text_delta', content: string }   // partial token during streaming
{ type: 'text_done', content: string }    // full response when stream completes
{ type: 'awaiting_approval' }
{ type: 'data_changed', entity: 'buckets' | 'calendar' }
{ type: 'error', message: string }
```

## Error Handling

Throw typed errors, catch at route level:

```typescript
class NotFoundError extends Error { status = 404; }
class AuthError extends Error { status = 401; }
class ValidationError extends Error { status = 400; }

app.onError((err, c) => {
  const status = 'status' in err ? (err as { status: number }).status : 500;
  logger.error(err.message, { error: err });
  return c.json({ error: err.message }, status);
});
```

## Authentication

1. Google OAuth for both login and API access
2. Email allowlist (`ALLOWED_USERS` env var)
3. JWT session cookie (30 days, httpOnly, secure)
4. Google tokens stored in Postgres `kv_store` table
5. `googleapis` auto-refreshes tokens; backend re-persists on `tokens` event

## Rules Summary

- Routes contain NO business logic — delegate to query functions
- Routes NEVER access `db` directly — use queries.ts
- MCP tools and REST routes share the same queries and connectors
- Google connectors have NO business logic
- All methods are async
- No fallbacks or silent defaults
