# 07 — Google Connectors

> Replaces the `@aaronsb/google-workspace-mcp` dependency with thin, in-process
> client wrappers around the official `googleapis` npm package.
>
> For full API method signatures, response types, and code examples: see `project/research/googleapis_reference.md`

---

## 1  Why Build Our Own

| Concern | `@aaronsb/google-workspace-mcp` | Our connectors |
|---|---|---|
| Unauthorized send bug (#52) | Open, unresolved | We own the approval gate (prompt-enforced) |
| Maturity | Alpha (`v2.0.0-alpha.4`), 131 stars | N/A — first-party code |
| Dependency chain | Our app → MCP server → `gws` CLI → Google APIs | Our app → `googleapis` → Google APIs |
| Auth control | Token file on disk, MCP server refreshes | `googleapis` auto-refreshes; we persist tokens |
| Process model | Subprocess (stdio MCP) | In-process — no IPC overhead |

---

## 2  Package Choice

Use the **monolith `googleapis`** package (not the per-API `@googleapis/*` scoped packages).
We need 4 API surfaces (Gmail, Calendar, Drive, Docs) — a single import is simpler.

```
pnpm add googleapis
```

---

## 3  OAuth Scopes (minimum set)

| Scope | Covers |
|---|---|
| `gmail.modify` | Read, list, compose, modify labels (read/unread/archive) |
| `gmail.send` | Send emails and replies |
| `calendar` | Full event CRUD + freebusy |
| `drive.readonly` | Search files, list files, export docs |

`documents.readonly` is not included in v1 — plain-text export via `drive.files.export` is sufficient.

---

## 4  Module Layout

```
src/
  server/
    google/
      auth.ts            ← OAuth2 client, token persistence, refresh listener
      gmail.ts           ← Gmail connector
      calendar.ts        ← Calendar connector
      drive.ts           ← Drive / Docs connector
      index.ts           ← Re-exports, shared types
    tools.ts             ← MCP tool definitions (calls into google/*)
```

### 4.1  `auth.ts` — Shared OAuth2 Client

Single `OAuth2Client` instance, created once at startup.

- Reads persisted tokens from the `google_tokens` Postgres table (see `03_data_layer.md`).
- **Tokens are encrypted at rest** using AES-256-GCM via Node `crypto`. `ENCRYPTION_KEY` must be 32 bytes (generated via `openssl rand -hex 32`, which outputs 64 hex characters encoding 32 bytes). Parse at startup with `Buffer.from(process.env.ENCRYPTION_KEY, 'hex')`. Only `access_token` and `refresh_token` fields are encrypted; other token fields (`scope`, `token_type`, `expiry_date`) are stored in plaintext. Ciphertext is stored as `<hex_iv>:<hex_ciphertext>` in the Postgres `text` column. Before persisting to Postgres, tokens are encrypted with the `ENCRYPTION_KEY` env var. On load, tokens are decrypted before being set on the OAuth2Client.
- Listens for `oauth2Client.on('tokens', ...)` to upsert refreshed tokens to Postgres automatically.
- Exposes `getAuthClient()` used by all three connectors.
- The backend's `/auth/google` and `/auth/google/callback` routes (already in the design) bootstrap the initial token.

**Key gotcha:** `refresh_token` is only returned on the first consent. We pass `access_type: 'offline'` and `prompt: 'consent'` on the auth URL to guarantee it.

### 4.2  `gmail.ts` — Gmail Connector

Wraps `google.gmail({ version: 'v1', auth })`.

| Method | Google API | Notes |
|---|---|---|
| `getMessage(id)` | `messages.get` | Format `full`; helper to decode nested `payload.parts` |
| `getThread(id)` | `threads.get` | Format `full`; returns all messages in thread |
| `searchThreads(query, maxResults)` | `threads.list` | Gmail search syntax (`is:unread`, `from:`, etc.) |
| `sendMessage(to, subject, body, opts?)` | `messages.send` | Builds RFC 2822 via helper; opts: `cc`, `bcc`, `replyTo` |
| `replyToThread(threadId, messageId, body)` | `messages.send` | Sets `threadId`, `In-Reply-To`, `References` headers |
| `createDraft(to, subject, body, threadId?)` | `drafts.create` | Returns draft ID |
| `modifyLabels(id, add?, remove?)` | `messages.modify` | Used for read/unread/archive |
| `markAsRead(id)` | → `modifyLabels(id, [], ['UNREAD'])` | Convenience |
| `archiveThread(threadId)` | `threads.modify` | Removes `INBOX` label from entire thread |
| `listLabels()` | `labels.list` | For reference/mapping |

**RFC 2822 construction:** Use the `mimetext` package to build MIME messages — avoids hand-rolling multipart encoding.

### 4.3  `calendar.ts` — Calendar Connector

Wraps `google.calendar({ version: 'v3', auth })`.

| Method | Google API | Notes |
|---|---|---|
| `listEvents(timeMin, timeMax, opts?)` | `events.list` | `singleEvents: true`, `orderBy: 'startTime'`; opts: `maxResults`, `q` |
| `getEvent(eventId)` | `events.get` | Full event resource |
| `createEvent(event)` | `events.insert` | `sendUpdates: 'all'` |
| `updateEvent(eventId, patch)` | `events.patch` | Partial update — safer than full PUT |
| `deleteEvent(eventId)` | `events.delete` | `sendUpdates: 'all'` |
| `checkFreeBusy(timeMin, timeMax, calendarIds?)` | `freebusy.query` | Defaults to `['primary']` |

**Gotcha:** `orderBy: 'startTime'` requires `singleEvents: true` — always set both.

### 4.4  `drive.ts` — Drive / Docs Connector

Wraps `google.drive({ version: 'v3', auth })` and optionally `google.docs({ version: 'v1', auth })`.

| Method | Google API | Notes |
|---|---|---|
| `searchFiles(query, opts?)` | `drive.files.list` | Translates simple queries into Drive search DSL; opts: `maxResults`, `orderBy` |
| `listRecentFiles(maxResults?)` | `drive.files.list` | `orderBy: 'viewedByMeTime desc'` |
| `readDocument(fileId)` | `drive.files.export` | Export as `text/plain` (v1); 10MB limit |
| `getFileMetadata(fileId)` | `drive.files.get` | Name, mimeType, modifiedTime, webViewLink |

**Drive search DSL note:** Different from Gmail's `q`. E.g., `name contains 'budget'`, `mimeType = 'application/vnd.google-apps.document'`.

---

## 5  MCP Tool Definitions

> For full SDK tool API (`tool()`, `createSdkMcpServer()`, Zod schemas): see `project/research/agent_sdk_reference.md`
> For full Google API method signatures and response types: see `project/research/googleapis_reference.md`

Tools are defined in `src/server/tools.ts` using the SDK's `tool()` helper with Zod schemas, registered on an in-process MCP server via `createSdkMcpServer()`. Each handler delegates to connectors (`google/*`) or query functions (`db/queries.ts`).

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const toolsServer = createSdkMcpServer({
  name: "assistant-tools",
  version: "1.0.0",
  tools: [/* tool definitions below */]
});
```

### 5.1  `sync_email` tool

All email reads go through this tool. It delegates to `src/server/email.ts`, which coordinates between `gmail.ts` (Google API) and `queries.ts` (Postgres). Every thread the agent reads is stored locally for bucketing, re-bucketing, and future lookups.

```typescript
tool("sync_email", "Read email data. All email reads go through this tool.", {
  action: z.enum(["sync", "search", "get_thread", "get_unbucketed"]),
  query: z.string().optional(),          // search (Gmail search syntax, e.g., "from:dan@acme.co")
  max_results: z.number().optional(),    // sync (default 200), search (default/max 25)
  thread_id: z.string().optional(),      // get_thread
}, async (args) => {
  const result = await handleSyncEmail(args);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
})
```

- **sync** — Bulk inbox refresh. Fetches recent thread IDs from Gmail, diffs against local DB, only fetches full content for new/changed threads. Returns stats: `{ new: N, updated: N }`. Use before bucketing.
- **search** — Ad-hoc Gmail search. Syncs matching threads to local DB, returns the matched threads. Use for "find threads from Dan", meeting prep, draft reply context.
- **get_thread** — Syncs a single thread from Gmail, returns from local cache with full messages.
- **get_unbucketed** — DB-only read. Returns next batch of 25 threads not yet assigned to a bucket. Use in the bucketing loop.

### 5.2  `action_email` tool

All email write operations. Every action requires user approval via chat confirmation.

```typescript
tool("action_email", "Perform actions on emails: send, reply, draft, archive, mark as read.", {
  action: z.enum(["send", "reply", "draft", "archive", "mark_read"]),
  to: z.string().optional(),             // send, draft
  cc: z.array(z.string()).optional(),    // send, draft
  subject: z.string().optional(),        // send, draft
  body: z.string().optional(),           // send, reply, draft
  thread_id: z.string().optional(),      // reply, draft, archive
  message_id: z.string().optional(),     // reply, mark_read
}, async (args) => {
  const result = await handleActionEmail(args);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
})
```

### 5.3  `calendar` tool

```typescript
tool("calendar", "Read, create, update, and delete Google Calendar events. Check availability.", {
  action: z.enum(["list", "get", "create", "update", "delete", "free_busy"]),
  time_min: z.string().optional(),       // list, free_busy (ISO 8601)
  time_max: z.string().optional(),       // list, free_busy
  event_id: z.string().optional(),       // get, update, delete
  summary: z.string().optional(),        // create, update
  description: z.string().optional(),    // create, update
  location: z.string().optional(),       // create, update
  start: z.string().optional(),          // create, update (ISO 8601)
  end: z.string().optional(),            // create, update
  attendees: z.array(z.string()).optional(),  // create, update (email addresses)
  query: z.string().optional(),          // list (free text search)
}, async (args) => {
  const result = await handleCalendar(args);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
})
```

### 5.4  `drive` tool

```typescript
tool("drive", "Search Google Drive files and read Google Docs content.", {
  action: z.enum(["search", "list_recent", "read", "metadata"]),
  query: z.string().optional(),          // search
  file_id: z.string().optional(),        // read, metadata
  max_results: z.number().optional(),    // search, list_recent
}, async (args) => {
  const result = await handleDrive(args);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
})
```

### 5.5  Side-Effect Tracking

The tool split makes read vs. write explicit by design:

- **Read (no confirmation needed):** `sync_email.*`, `calendar.list`, `calendar.get`, `calendar.free_busy`, `drive.*`
- **Write (must go through chat-based approval):** `action_email.*`, `calendar.create`, `calendar.update`, `calendar.delete`

The agent's system prompt instructs it to describe proposed write actions and wait for user confirmation before executing. Approval is enforced at the prompt level in v1. Tool-layer enforcement can be added later if needed.

---

## 6  Auth Flow (Unified Login + API Access)

Google OAuth serves as both app login and API authorization. An email allowlist (`ALLOWED_USERS` env var) gates access. See `04_backend.md` for full auth implementation.

```
┌──────────┐     /auth/google      ┌──────────┐     consent      ┌──────────┐
│ Frontend  │ ──────────────────▶   │ Backend  │ ───────────────▶ │ Google   │
│ (not      │                       │          │  openid + email  │ OAuth    │
│  logged   │     /auth/google/cb   │          │  + gmail/cal/    │          │
│  in)      │ ◀──────────────────   │          │    drive scopes  │          │
└──────────┘                        └────┬─────┘                  └──────────┘
                                         │
                                  1. exchange code for tokens
                                  2. get user email → check ALLOWED_USERS
                                  3. if allowed: persist tokens + set JWT session cookie
                                  4. if not: 403
                                         │
                                    ┌────▼─────┐
                                    │ auth.ts  │  ← reads tokens at startup
                                    │ OAuth2   │  ← auto-refreshes via googleapis
                                    │ Client   │  ← persists on 'tokens' event
                                    └────┬─────┘
                                         │
                          ┌──────────────┼──────────────┐
                          │              │              │
                     ┌────▼───┐    ┌────▼─────┐   ┌───▼────┐
                     │gmail.ts│    │calendar.ts│   │drive.ts│
                     └────────┘    └──────────┘   └────────┘
```

No MCP subprocess. No separate login step. One Google sign-in gives you app access + API tokens.

---

## 7  Key Implementation Notes

1. **RFC 2822 email construction** — Use the `mimetext` package. Don't hand-roll MIME. Base64url-encode the result for `messages.send`.

2. **Gmail message body decoding** — `payload.parts` is recursive and varies by content type. Write a helper that walks the tree and extracts `text/plain` and `text/html` parts, base64url-decoding `body.data`.

3. **Batch reads** — `messages.list` returns only IDs. For inbox triage, we'll need to fetch N messages. Use `Promise.all` with `p-limit` for concurrency control (e.g., `pLimit(5)` for max 5 concurrent requests). Respect the 15,000 quota units/min per-user limit.

4. **Token persistence** — Upsert tokens to the `google_tokens` Postgres table. The `tokens` event fires on every refresh, so we re-persist each time. No filesystem or env var needed.

5. **Error handling** — `googleapis` throws `GaxiosError` (import from the `gaxios` package: `import { GaxiosError } from 'gaxios'`). Access `err.status` and `err.response?.data`. Map common cases:
   - `401` → token expired / revoked → trigger re-auth flow
   - `403` → scope missing or quota exceeded (check `err.response?.data?.error?.errors?.[0]?.reason`)
   - `404` → resource not found (message/event deleted)
   - `429` → rate limited → exponential backoff

6. **Rate limits for a single user are generous** — 15k quota units/min for Gmail, 12k queries/60s for Drive. Not a v1 concern.

7. **Drive search DSL differs from Gmail** — `name contains 'x'` not `subject:x`. The `drive.ts` connector should expose a friendly API and translate to Drive query syntax internally.

---

## 8  Dependencies Delta

### Remove
- `@aaronsb/google-workspace-mcp` (npm package — no longer spawned as subprocess)

### Add
- `googleapis` (official Google API client — already planned for OAuth bootstrap)
- `mimetext` (for RFC 2822 email construction)

### Keep
- `@anthropic-ai/claude-agent-sdk` (agent framework)
- All existing deps unchanged

---

## 9  Migration Checklist

- [ ] Create `src/server/google/` module with `auth.ts`, `gmail.ts`, `calendar.ts`, `drive.ts`, `index.ts`
- [ ] Implement OAuth2 client with token persistence and refresh listener in `auth.ts`
- [ ] Implement Gmail connector methods in `gmail.ts`
- [ ] Implement Calendar connector methods in `calendar.ts`
- [ ] Implement Drive connector methods in `drive.ts`
- [ ] Replace `manage_email`, `manage_calendar`, `manage_drive`, `manage_accounts`, `queue_operations` MCP tool defs with `gmail`, `calendar`, `drive` tools in `tools.ts`
- [ ] Remove MCP subprocess spawn from `agent.ts` (no more `npx @aaronsb/google-workspace-mcp`)
- [ ] Update system prompt to reference new tool names
- [ ] Update auth routes to persist tokens to `google_tokens` Postgres table
- [ ] Add `googleapis` and `mimetext` to `package.json`
- [ ] Remove `@aaronsb/google-workspace-mcp` from `package.json`
- [ ] Test: OAuth flow end-to-end
- [ ] Test: Each connector method against real Google APIs
