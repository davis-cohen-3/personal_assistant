# Spec Issues

Issues found during design doc review. Must be resolved before implementation.

---

## Critical — Will Block or Confuse Implementation

### ~~1. Missing calendar + drive tools in `tools.ts` (04_backend.md)~~ ✅ RESOLVED

Added `calendar` and `drive` tool definitions to the tools.ts code block in 04_backend.md, matching the canonical schemas from 07_google_connectors.md (sections 5.3, 5.4). Both follow the same thin-handler pattern as existing tools, delegating to `google/calendar.ts` and `google/drive.ts` connectors. Calendar write actions (create, update, delete) note ConfirmAction requirement in the tool description, consistent with `action_email`. Updated section header from "6 Tools" to "5 Tools" to match the actual tool count: `buckets`, `sync_email`, `action_email`, `calendar`, `drive`.

### ~~2. Table count inconsistencies across docs~~ ✅ RESOLVED

Fixed all references to say 9 tables: 01_system_overview.md, 08_architecture_diagrams.md (both occurrences), 06_tech_stack.md.

### ~~3. Tool count inconsistencies~~ ✅ RESOLVED

Fixed 02_agent_spec.md "All 6 tools" → "All 7 tools". Canonical tool list is 7: sync_email, action_email, calendar, drive, bucket_manage, bucket_assign_batch, people_manage. (04_backend.md tools.ts code still missing calendar/drive — tracked by issue #1.)

### ~~4. `boolean` import missing from schema~~ ✅ RESOLVED

Added `boolean` to the import in 03_data_layer.md.

### ~~5. Architecture diagram contradicts token storage decision~~ ✅ RESOLVED

Removed `~/.config/pa-agent/google-tokens.json` from disk section. Added `google_tokens`, `email_threads`, and `email_messages` tables to the Postgres diagram. Fixed "Never cached locally" to accurately describe that Gmail is cached locally for classification while Calendar/Drive are not.

### ~~6. `sync_email` search only returns unbucketed threads~~ ✅ RESOLVED

Redesigned `sync_email` with 4 actions and a new `email.ts` orchestration layer:
- **`sync`** — bulk inbox refresh, diff-based (only fetches new/changed threads), returns stats only
- **`search`** — ad-hoc Gmail query, syncs results to DB, returns matched threads (fixes the original issue)
- **`get_thread`** — single thread by ID, syncs and returns from DB
- **`get_unbucketed`** — DB-only, returns next 25 unbucketed threads for bucketing workflow

New `src/server/email.ts` orchestrates between `gmail.ts` and `queries.ts`. Tools and routes both delegate to it. Updated: 04_backend.md (tools.ts, routes.ts, new email.ts section), 02_agent_spec.md (inbox review skill, tool table, skill references), 03_data_layer.md (new query), 06_tech_stack.md (project structure), 07_google_connectors.md (tool spec), decisions_log.md (3 new decisions).

### ~~7. Missing `logger` module~~ ✅ RESOLVED

Decided to use `console.error`/`console.warn` directly for v1 instead of a custom logger. Removed all `import { logger }` references from 04_backend.md, updated code-quality.md and CLAUDE.md to reflect the new convention. GCP Cloud Run captures stdout/stderr natively — no library needed for a single-user app.

---

## Medium — Will Cause Friction

### ~~8. `bucket_assign` (single) vs `bucket_assign_batch` — which tools actually exist?~~ ✅ RESOLVED

Merged all three bucket tools (`bucket_manage`, `bucket_assign`, `bucket_assign_batch`) into a single `buckets` tool with actions: `list`, `create`, `update`, `delete`, `assign`. The `assign` action takes an `assignments` array (1-25 items), so single and batch assignment use the same interface. Updated: 04_backend.md (tools.ts code), 02_agent_spec.md (tool list, system prompt, skill references), 07_google_connectors.md, 08_architecture_diagrams.md, 06_tech_stack.md, 01_system_overview.md, 10_dev_tooling.md. Tool count is now 6: `sync_email`, `action_email`, `calendar`, `drive`, `buckets`.

### ~~9. Architecture diagram says "Never cached locally" for Gmail — but we do cache~~ ✅ RESOLVED

Already fixed as part of issue #5. The diagram now correctly states: "Gmail threads/messages are cached locally (email_threads + email_messages) for classification. Calendar and Drive are fetched on demand, not cached." The old "Never cached locally" text is gone.

### ~~10. `cc` validation is single email, should be array~~ ✅ RESOLVED

Changed `cc` to `string[]` across all three locations: route schema in 04_backend.md (`z.array(z.string().email()).optional()`), MCP tool schema in 04_backend.md (`{ type: 'array', items: { type: 'string' } }`), and tool spec in 07_google_connectors.md (`cc?: string[]`).

### ~~11. Deployment doc says `console.log` is fine~~ ✅ RESOLVED

Aligned all docs on using `console.error`/`console.warn` (no custom logger). Updated 09_deployment.md, 04_backend.md, code-quality.md, and CLAUDE.md. `console.log` is still discouraged (debug noise only), but `console.error`/`console.warn` are the standard logging approach.

---

## Minor — Cosmetic / Low Risk

### ~~12. CalendarView missing from component tree diagram~~ ✅ RESOLVED

Added CalendarView to the component tree in 08_architecture_diagrams.md section 7, between BucketBoard and ThreadDetail. Shows `GET /api/calendar/events` endpoint and event card → EventDetail click flow, matching 05_frontend.md.

### ~~13. `ConversationList.handleDelete` type mismatch~~ ✅ RESOLVED

Widened `onSelect` prop type from `(id: string) => void` to `(id: string | null) => void` in 05_frontend.md. Caller (`setActiveConversationId`) is already `useState<string | null>` so no further changes needed.

### ~~14. Static file serving has auth middleware issue~~ ✅ RESOLVED

Moved static file serving (assets + SPA catch-all) before auth middleware. Scoped auth middleware to `/api/*` and `/ws` only, so the React app loads unauthenticated while API and WebSocket routes remain protected.

---
---

# Round 2 — Architecture Review

Issues found during full architecture, feasibility, and logic consistency review across all 12 design docs.

---

## Blockers

### 15. Claude Agent SDK API mismatch

**Docs affected:** 02_agent_spec.md, 04_backend.md

The design assumes an API surface that likely doesn't exist in the Claude Agent SDK:
- `new Agent({ ...agentConfig, resume: sessionId })` — SDK doesn't expose a stateful Agent class
- `session.chat(content, { onPartialMessage })` — no `.chat()` method
- `session.sessionId`, `response.fullText`, `response.delta` — not documented properties
- `createSdkMcpServer()` — may not exist as an export

The SDK's TypeScript entry point is a `query()` async generator that yields streaming events, not a stateful class with `.chat()`. Session resume (`.jsonl` files) is a CLI implementation detail, not a documented SDK feature.

**Action:** Read the actual SDK source at `node_modules/@anthropic-ai/claude-code-sdk` before writing `agent.ts`. Restructure the backend around the real API.

---

### ~~16. Approval flow has no detection mechanism~~ ✅ RESOLVED

**Docs affected:** 02_agent_spec.md, 04_backend.md, 05_frontend.md

The backend has no way to know when the agent "proposed an action" vs. sent normal text. The design shows the backend emitting `awaiting_approval` over WebSocket, but there's no heuristic or signal for when to do this. The agent can't pause mid-turn.

**Options:**
1. Agent calls a `request_approval` MCP tool → tool handler emits `awaiting_approval` over WS → frontend shows Approve/Reject buttons. Detectable and reliable.
2. Drop the special approval UX for v1. User just says "go ahead" in chat. Simpler, no special protocol.

**Resolution:** Chose option 2 — chat-based approval for v1. Removed `awaiting_approval` WS message type, `approve`/`reject` WS message types, `pendingApproval` state, and Approve/Reject buttons from all docs (01, 02, 04, 05, 07, 08, wireframes, decisions_log). Agent describes actions and asks for confirmation in text; user replies in natural language.

---

## Must-Fix (will cause bugs if built as-written)

### ~~17. `handleWebSocket` not declared async~~ ✅ RESOLVED

**Doc:** 04_backend.md

`export function handleWebSocket(ws)` uses `await` at the top level but isn't declared `async`. Code won't compile.

**Resolution:** Already correct in current version — `handleWebSocket` is sync (sets up event listeners only), all I/O is in the `ws.on('message', async ...)` callback which is properly async. Also removed stale `approve`/`reject` entries from the Zod message schema.

---

### ~~18. Resume catch block swallows all errors~~ ✅ RESOLVED

**Doc:** 04_backend.md

```typescript
try { session = new Agent({ ...agentConfig, resume: ... }); }
catch { session = new Agent(agentConfig); }
```

This catches ALL errors (network, SDK misconfiguration, etc.), not just "session file missing." Violates code-quality rules on swallowed exceptions.

**Resolution:** Already fixed — the `new Agent()` constructor pattern was replaced with a `query()` call that takes `resume: sessionId` in options. No try/catch, no swallowed errors. If the SDK can't resume, the error propagates.

---

### ~~19. Approve/reject responses never streamed to frontend~~ ✅ RESOLVED

**Doc:** 04_backend.md

The `approve` and `reject` WebSocket handlers call `session.chat('Approved. Go ahead.')` but don't stream `text_delta`/`text_done` events back. The frontend only updates messages on those events, so the agent's confirmation text is silently lost.

**Resolution:** No longer applicable — approve/reject message types were removed. Approval is now a normal chat message, which uses the standard streaming path.

---

### ~~20. Contradictory `session.close()` in WS close handler~~ ✅ RESOLVED

**Doc:** 04_backend.md

Two code snippets contradict each other:
- First close handler (~line 263): does NOT call `session.close()`, comment says "Do NOT destroy session"
- Second snippet (Data Change Events section, ~line 310): calls `session.close()`

02_agent_spec.md says "WebSocket disconnects → SDK session preserved on disk (not destroyed)."

**Resolution:** Already fixed — the second snippet in 04_backend.md no longer calls `session.close()`. Both snippets now consistently say "Do NOT destroy session."

---

### ~~21. `WebSocketContext` never defined or provided~~ ✅ RESOLVED

**Doc:** 05_frontend.md

`useDataChangedEvent` calls `useContext(WebSocketContext)`, but `WebSocketContext` is never created or provided. The `Chat` component owns the WebSocket via a local `useRef`, not a context provider. All hooks that depend on `data_changed` events (`useBuckets`, `useCalendarEvents`, `useConversations`) will silently get `undefined` — the agent-to-frontend refresh loop won't work.

**Resolution:** Already fixed — `WebSocketProvider` added to 05_frontend.md. Wraps the authenticated app, Chat and data hooks both consume via `useContext(WebSocketContext)`.

---

### ~~22. REST bucket creation skips re-bucketing~~ ✅ RESOLVED

**Doc:** 04_backend.md

`POST /api/buckets` calls `queries.createBucket()` but does NOT call `queries.markAllForRebucket()` or `emitDataChanged('buckets')`. The MCP tool does both. Contradicts settled decision: "When a new bucket is created, all existing thread_buckets rows are marked `needs_rebucket = true`."

**Resolution:** Already fixed — `POST /api/buckets` calls both `markAllForRebucket()` and `emitDataChanged('buckets')`.

---

### ~~23. `google_tokens` upsert won't work~~ ✅ RESOLVED

**Doc:** 03_data_layer.md

The `google_tokens` table has a UUID primary key (auto-generated). `upsertGoogleTokens` uses ON CONFLICT DO UPDATE, but a new UUID is generated on every INSERT — there's no conflict target that would match an existing row. Every call inserts a new row instead of updating.

**Resolution:** Changed `id` from `uuid` (auto-generated) to `text` with fixed value `'primary'`. Upsert targets this fixed PK — always hits the same row. Updated schema and field table in 03_data_layer.md.

---

### ~~24. Redundant composite unique index on `email_messages`~~ ✅ RESOLVED

**Doc:** 03_data_layer.md

`email_messages` has both:
- `uniqueGmailMessage` — unique on `gmail_message_id` (sufficient, message IDs are globally unique)
- `threadIdx` — unique on `(gmail_thread_id, gmail_message_id)` (redundant)

Two unique indexes on overlapping columns can cause ON CONFLICT errors in Drizzle's `onConflictDoUpdate`.

**Resolution:** Changed `threadIdx` from `uniqueIndex` on `(gmail_thread_id, gmail_message_id)` to a non-unique `index` on `gmail_thread_id` only. `uniqueGmailMessage` on `gmail_message_id` remains the sole conflict target for upserts.

---

### ~~25. No migration step in GCP Cloud Run deploy pipeline~~ ✅ RESOLVED

**Doc:** 09_deployment.md

GCP Cloud Run start command is `node dist/server/index.js` with no migration step. Schema changes after initial deploy won't be applied.

**Resolution:** Added `&& pnpm drizzle-kit migrate` to the GCP Cloud Run build command in 09_deployment.md. Migrations run after build, before the new version starts.

---

## Doc Contradictions

### ~~26. "Conversation history is not persisted"~~ ✅ RESOLVED

**Doc:** 09_deployment.md, line 46

Says "Conversation history is not persisted; each reconnect starts fresh." Every other doc says Postgres `chat_messages` provides durable history.

**Resolution:** Already fixed — 09_deployment.md now correctly says "Chat message history is preserved in Postgres and remains visible in the UI."

---

### ~~27. "Persist tokens to disk" in auth flow diagram~~ ✅ RESOLVED

**Doc:** 08_architecture_diagrams.md, Auth Flow step 4

**Resolution:** Already fixed — auth flow diagram says "persist tokens to Postgres".

---

### ~~28. Morning Briefing uses subagents, but decisions log says no subagents~~ ✅ RESOLVED

**Docs:** 02_agent_spec.md, decisions_log.md

02_agent_spec.md Morning Briefing skill: "The main agent fans out to subagents for parallel execution."
decisions_log.md: "Single agent in v1 — no subagents."

**Resolution:** Already fixed — decisions_log now includes "Subagents for parallel read-only work" as a settled decision. The "no subagents" entry was removed. 02_agent_spec.md and decisions_log are consistent.

---

## Lower Priority

### ~~29. Missing hook mutations (`updateBucket`, `assignThread`)~~ ✅ RESOLVED

**Doc:** 05_frontend.md

`useBuckets` hook summary lists `updateBucket` and `assignThread` mutations, but the implementation only has `createBucket` and `deleteBucket`. Backend has the corresponding routes.

**Resolution:** Added `updateBucket` (PATCH) and `assignThread` (POST /api/buckets/assign) mutations to `useBuckets` hook in 05_frontend.md.

---

### ~~30. "Start Day" button has no trigger mechanism~~ ✅ RESOLVED

**Docs:** 02_agent_spec.md, 05_frontend.md, wireframes.md

Wireframe shows a "Start Day" button. Agent spec says it triggers Morning Briefing. No doc specifies what the button sends.

**Resolution:** Added to wireframes.md — button sends `{ type: 'chat', content: 'Start my day' }` over WebSocket, triggering Morning Briefing via system prompt.

---

### ~~31. Archive operates on single message, not thread~~ ✅ RESOLVED

**Docs:** 05_frontend.md, 04_backend.md

`ThreadDetail` calls `POST /api/gmail/messages/:id/archive` with the last message's ID. This removes INBOX from one message, not the thread. Users expect thread-level archive.

**Resolution:** Changed to thread-level archive across all docs. gmail.ts now has `archiveThread(threadId)` using `threads.modify`. email.ts, MCP tool, REST route (`/api/gmail/threads/:id/archive`), and frontend ThreadDetail all updated to use thread ID.

---

### ~~32. Empty query on `GET /api/gmail/threads`~~ ✅ RESOLVED

**Doc:** 04_backend.md

When `q` is empty, `email.search('')` passes an empty Gmail search query with undefined behavior.

**Resolution:** `q` is now required — returns 400 if omitted. Inbox listing uses `GET /api/buckets` (not this route). This route is for ad-hoc search only.

---

### ~~33. Template apply skips `emitDataChanged`~~ ✅ RESOLVED

**Doc:** 04_backend.md

`POST /api/bucket-templates/:id/apply` creates buckets but doesn't emit `data_changed`. BucketBoard won't update on first launch.

**Resolution:** Added `emitDataChanged('buckets')` to the template apply route in 04_backend.md.

---

### ~~34. Conversation title updates never reach ConversationList~~ ✅ RESOLVED

**Doc:** 05_frontend.md

`conversation_updated` WebSocket event updates title in Postgres, but `ConversationList` only listens for `data_changed` with `entity: 'conversations'`. No code ever emits that event.

**Resolution:** Added `emitDataChanged('conversations')` after auto-title update in 04_backend.md. `useConversations` subscribes to `data_changed` for `conversations` and will refetch.

---

### ~~35. `syncInbox` does 200 sequential API calls~~ ✅ RESOLVED

**Doc:** 07_google_connectors.md

200 sequential `getThread()` calls on fresh install = 20-60 seconds wall time. Section 7.3 mentions `Promise.all` with concurrency limits but implementation shows sequential loop.

**Resolution:** Already fixed — `syncInbox` uses `p-limit` with `Promise.all` for concurrent thread fetching.

---

### ~~36. No handling for OAuth denial~~ ✅ RESOLVED

**Doc:** 04_backend.md

`/auth/google/callback` reads `c.req.query('code')` without checking for `error=access_denied` (user clicks Cancel). Would throw unhandled GaxiosError → 500.

**Resolution:** Added `error` query param check at top of callback handler — redirects to `/?auth_error=...`. Also validates `code` is present before calling `getToken`.

---

### ~~37. Module boundary linter doesn't cover `email.ts`~~ ✅ RESOLVED

**Doc:** 10_dev_tooling.md

`lint_module_boundaries.ts` doesn't prevent `google/*` connectors from importing `email.ts` (upward dependency from infrastructure into application logic).

**Resolution:** Added `'./email'` and `'../email'` to the `google/` forbidden imports in 10_dev_tooling.md. Updated rule description too.

---

### ~~38. Auth middleware catch swallows non-JWT errors~~ ✅ RESOLVED

**Doc:** 04_backend.md

`authMiddleware` catches all JWT verify errors and returns 401. Network errors or misconfigured secrets silently return 401 too.

**Resolution:** Acceptable as-is. The catch logs the error via `console.warn` and returns 401 — this is legitimate control flow for auth middleware. Any JWT verification failure (expired, malformed, wrong secret) should result in 401. The error is logged for debugging, not silently swallowed.

---

### ~~39. Mark-read on thread open doesn't specify which messages~~ ✅ RESOLVED

**Doc:** 05_frontend.md

`ThreadDetail` auto-calls `POST /api/gmail/messages/:id/read` on open. Doesn't specify which message ID when thread has multiple messages.

**Resolution:** Clarified in 05_frontend.md — marks the latest message only (most recent is typically the unread one). Sufficient for v1.

---

### ~~40. Long-lived tab auth expiry gap~~ ✅ RESOLVED

**Doc:** 04_backend.md

Auth middleware only runs at WebSocket connection time. JWT could expire while WS is open — REST calls would 401 but WS stays connected.

**Resolution:** Added to 05_frontend.md WebSocket lifecycle: "If any REST call returns 401, close the WebSocket and redirect to `/auth/google`."
