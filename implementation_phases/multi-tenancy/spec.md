# Multi-Tenancy: Per-User Data Isolation

## Problem

The app is single-tenant. One `google_tokens` row (PK `'primary'`), no `user_id` on any table. If a second person auths on the deployed site, they overwrite the first person's Google tokens and see all the same conversations and buckets.

## Goal

Any Google user can sign in to the deployed app and get their own isolated data — conversations, buckets, email cache, and Google tokens. No email/password auth. Google OAuth remains the sole auth mechanism.

## Schema Changes

### New table: `users`

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text,
  avatar_url text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
```

Created on first Google login via the OAuth callback. Email comes from `oauth2.userinfo.get()`.

### Add `user_id` to existing tables

| Table | Change |
|-------|--------|
| `conversations` | Add `user_id uuid NOT NULL REFERENCES users(id)` |
| `buckets` | Add `user_id uuid NOT NULL REFERENCES users(id)` |
| `google_tokens` | Replace `id text PK` with `user_id uuid PK REFERENCES users(id)` |
| `email_threads` | Add `user_id uuid NOT NULL REFERENCES users(id)` |
| `email_messages` | No change — scoped via `gmail_thread_id` FK to `email_threads` |
| `thread_buckets` | No change — scoped via FKs to `email_threads` and `buckets` |
| `chat_messages` | No change — scoped via `conversation_id` FK to `conversations` |
| `bucket_templates` | No change — global, shared across users |

Only four tables need the column. The rest are scoped transitively through FKs.

### Migration strategy

1. Add `users` table
2. Add `user_id` columns as nullable
3. Create a user row for the existing data (from current `ALLOWED_USERS` email)
4. Backfill `user_id` on all existing rows
5. Set columns to `NOT NULL`

## Auth Changes

### Drop `ALLOWED_USERS`

Remove the env var and the allowlist check in `auth.ts`. Anyone who completes Google OAuth gets an account. Access control is handled by Google Cloud Console's OAuth consent screen (testing mode = only explicitly added test users can auth).

### OAuth callback (`auth.ts`)

After Google returns the user's email:

1. Upsert into `users` (create if first login, update name/avatar if changed)
2. Sign JWT with `{ userId, email }` instead of just `{ email }`
3. Call `persistTokens(userId, tokens)` instead of `persistTokens(tokens)`

### Auth middleware

Currently sets `c.set("userEmail", payload.email)`. Change to also set `c.set("userId", payload.userId)` from the JWT payload. Routes extract `userId` directly — no DB lookup needed per request.

### `google/auth.ts` — Per-user tokens

| Function | Before | After |
|----------|--------|-------|
| `getGoogleTokens()` | Fetches row with `id='primary'` | `getGoogleTokens(userId)` — fetches by `user_id` |
| `persistTokens(tokens)` | Upserts with `id='primary'` | `persistTokens(userId, tokens)` — upserts with `user_id` |
| `isGoogleConnected()` | Checks if any row exists | `isGoogleConnected(userId)` — checks for user's row |
| `loadTokens()` | Loads single row into global client | Remove — tokens loaded per-request instead |
| `getAuthClient()` | Returns singleton `OAuth2Client` | Returns a client with credentials set for the given user |

The singleton `oauthClient` still handles OAuth flow (generating auth URLs, exchanging codes). But for API calls, each request needs the correct user's tokens loaded. Two options:

**Option A (simpler):** Keep one `OAuth2Client` instance. Before each Google API call, set the credentials for the current user. This works because requests are sequential per-user.

**Option B (safer):** Create an `OAuth2Client` per request. Small overhead but no shared mutable state.

Recommend **Option A** for v1 with a `withUserTokens(userId)` helper that loads and sets credentials.

## Query Changes

Every query function that touches a user-scoped table gets `userId: string` as its first parameter.

### Buckets
- `listBuckets(userId)` — WHERE user_id = userId
- `listBucketsWithThreads(userId)` — scope buckets and joined thread_buckets
- `createBucket(userId, ...)` — include user_id in INSERT
- `updateBucket(userId, id, ...)` — WHERE id = id AND user_id = userId
- `deleteBucket(userId, id)` — WHERE id = id AND user_id = userId
- `applyBucketTemplate(userId, templateId)` — check user's buckets, insert with user_id

### Email threads
- `upsertEmailThread(userId, ...)` — include user_id in UPSERT
- `listEmailThreadsByGmailIds(userId, ids)` — WHERE user_id = userId
- `getUnbucketedThreads(userId, limit)` — WHERE user_id = userId

### Thread assignments
- `assignThread(userId, gmailThreadId, bucketId)` — include user_id
- `assignThreadsBatch(userId, assignments)` — include user_id
- `unassignThread(userId, gmailThreadId)` — WHERE user_id = userId

### Conversations
- `listConversations(userId)` — WHERE user_id = userId
- `getConversation(userId, id)` — WHERE id = id AND user_id = userId
- `createConversation(userId, title)` — include user_id in INSERT
- `updateConversation(userId, id, ...)` — WHERE id = id AND user_id = userId
- `deleteConversation(userId, id)` — WHERE id = id AND user_id = userId
- `listMessagesByConversation(userId, convId)` — verify conversation belongs to user
- `createChatMessage(userId, convId, role, content)` — verify conversation belongs to user

### Rebucketing
- `markAllForRebucket(userId)` — WHERE user_id = userId
- `getThreadsNeedingRebucket(userId, limit)` — WHERE user_id = userId
- `clearRebucketFlag(userId, gmailThreadIds)` — WHERE user_id = userId
- `countUnbucketedThreads(userId)` — WHERE user_id = userId

### Google tokens
- `getGoogleTokens(userId)` — WHERE user_id = userId
- `upsertGoogleTokens(userId, tokens)` — upsert on user_id

### No changes needed
- `listBucketTemplates()` — global
- `getBucketTemplate(id)` — global

## Route Changes

Every route extracts `userId` from the Hono context (set by authMiddleware) and passes it to queries/orchestration.

```typescript
// Pattern for all routes
const userId = c.get("userId") as string;
```

No logic changes — just threading `userId` through to the query layer.

## Email Orchestration (`email.ts`)

Every function gets `userId` as first param, threaded to the queries it calls:

- `syncInbox(userId, maxResults)`
- `search(userId, query, maxResults)`
- `getThread(userId, gmailThreadId)`
- `getUnbucketedThreads(userId)`
- `sendMessage(userId, ...)`
- `replyToThread(userId, ...)`
- `createDraft(userId, ...)`
- `archiveThread(userId, gmailThreadId)`
- `markAsRead(userId, messageId)`

These also need the user's Google tokens loaded before calling Gmail APIs. The `withUserTokens(userId)` helper handles this.

## MCP Tools (`tools.ts`)

MCP tools run inside the Agent SDK, not in HTTP context. They need `userId` to call queries.

**Approach:** `createCustomMcpServer` accepts `userId` and closes over it. Tool handlers access it from the closure.

```typescript
export function createCustomMcpServer(userId: string) {
  // All handlers below capture userId from this closure
  server.tool("buckets", ..., async (params) => {
    const result = await listBuckets(userId);
    // ...
  });
}
```

This already works with the current architecture — `createCustomMcpServer` is called per-query in `streamQuery`, so `userId` is naturally available.

## Agent / WebSocket (`agent.ts`)

1. `handleWebSocket` extracts `userId` from `c.get("userId")`
2. Passes it to all `getConversation(userId, id)`, `createChatMessage(userId, ...)` calls
3. Passes it to `streamQuery(ws, conversationId, prompt, sessionId, userId)`
4. `streamQuery` passes it to `createCustomMcpServer(userId)`

## Shared Types (`types.ts`)

Add `User` type. Add `user_id` to `Conversation` type. No frontend-facing API changes needed — the frontend never sees `user_id` (it's implicit from the session).

## Frontend Changes

None. The frontend is already auth-gated. The session cookie identifies the user. All API calls are automatically scoped server-side.

## What to Remove

- `ALLOWED_USERS` env var and check in `auth.ts`
- `loadTokens()` call in `index.ts` startup (tokens loaded per-request now)
- Fixed `id='primary'` pattern in `google_tokens` schema

## Task Order

1. **Schema + migration** — users table, add user_id columns, backfill
2. **Auth changes** — JWT payload, middleware, drop ALLOWED_USERS, OAuth callback creates user
3. **Google token storage** — per-user tokens, withUserTokens helper
4. **Query functions** — add userId param to all ~25 functions
5. **Routes** — extract userId, pass to queries
6. **Email orchestration** — thread userId through
7. **MCP tools** — pass userId via createCustomMcpServer closure
8. **Agent/WebSocket** — thread userId from context through to streamQuery
9. **Remove startup loadTokens** — no longer needed
10. **Test** — verify two users see isolated data

## Files Changed

| File | Tasks |
|------|-------|
| `src/server/db/schema.ts` | 1 |
| `src/server/db/migrations/0001_*.sql` | 1 |
| `src/server/auth.ts` | 2 |
| `src/server/google/auth.ts` | 3 |
| `src/server/db/queries.ts` | 4 |
| `src/server/routes.ts` | 5 |
| `src/server/email.ts` | 6 |
| `src/server/tools.ts` | 7 |
| `src/server/agent.ts` | 8 |
| `src/server/index.ts` | 9 |
| `src/shared/types.ts` | 1, 4 |
| `tests/integration/db/queries.test.ts` | 4 |
| `tests/unit/auth.test.ts` | 2 |
| `tests/unit/routes.test.ts` | 5 |
| `tests/unit/email.test.ts` | 6 |
| `tests/unit/tools.test.ts` | 7 |
| `tests/unit/agent.test.ts` | 8 |
