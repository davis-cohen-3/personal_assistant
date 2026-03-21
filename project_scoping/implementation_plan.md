# Implementation Plan

Phased build plan for the personal assistant agent. Each phase produces a working, tested slice. Risky assumptions are verified early. Tests are written inline via TDD — never deferred to a later phase.

**Principles:**
- Each phase depends on the previous (tasks within a phase can sometimes be parallelized)
- Every task includes its own tests — no separate "testing phase"
- Verify risky assumptions before building around them
- Review issues (HIGH-x, SEC-x) are wired into the tasks where they apply

---

## Prerequisite: GCP Project Setup (manual, do before Phase 3)

**Do this in the Google Cloud Console before starting Phase 3:**
- Create a GCP project (e.g., `personal-assistant-agent`)
- Enable APIs: Gmail API, Google Calendar API, Google Drive API
- Create OAuth 2.0 credentials (application type: "Web application")
- Set authorized redirect URI: `http://localhost:3000/auth/google/callback`
- Copy `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` into `.env`
- Set `GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback` in `.env`

**Verify:** Credentials exist in GCP console. `.env` has all three Google values populated.

---

## Phase 1: Scaffolding + Foundations

Get the project runnable with quality gates active from the first commit. After this phase, `pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint`, and `pnpm lint:arch` all succeed.

### Task 1.1: Project structure, configs, and placeholders

**Create:**
- `package.json` — all dependencies and devDependencies from `06_tech_stack.md`, scripts section (include `pg` for connection pooling). Pin Biome to a specific version (MIN-010).
- `tsconfig.json` — base config (strict mode, ESNext, bundler resolution, path aliases)
- `tsconfig.server.json` — server build config extending base. Override `moduleResolution` to `"node16"` (FEAS-013).
- `vite.config.ts` — React plugin, client root, proxy for `/ws`, `/auth`, `/api`
- `vitest.config.ts` — node environment, unit test include pattern
- `biome.json` — recommended rules, 2-space indent, 100 line width
- `docker-compose.yml` — Postgres 16 with `pa_agent` user/db
- `drizzle.config.ts` — schema path, migrations output, postgresql dialect
- `.env.example` — all env vars: `DATABASE_URL`, `JWT_SECRET`, `CSRF_SECRET` (HIGH-9), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `ALLOWED_USERS`, `ANTHROPIC_API_KEY`, `ENCRYPTION_KEY`
- `.gitignore` — dist, node_modules, .env, logs, .DS_Store, SDK session files (SEC-006)
- `src/server/index.ts` — minimal Hono app with health check (`GET /health` → `{ status: 'ok' }`)
- `src/client/main.tsx` — minimal React render placeholder
- `src/client/globals.css` — Tailwind base imports
- `src/client/App.tsx` — `<div>App</div>` placeholder

**Reference:** `06_tech_stack.md` (full file)

**Verify:** `pnpm install` succeeds, `pnpm run build` succeeds, `pnpm test` runs (0 tests), `pnpm run lint` passes, health check returns `{ status: 'ok' }`.

### Task 1.2: Foundations + architecture linters + git hooks

**Create:**
- `src/server/exceptions.ts` — `AppError` class with status code, cause, and `userFacing: boolean` flag (HIGH-4). Only expose `err.message` when `userFacing` is true; otherwise return a generic message and log details server-side.
- `src/shared/types.ts` — all shared types from `05_frontend.md` (Shared Types section):
  - `ChatMessage` (role + text + optional streaming flag)
  - WebSocket message types — frontend→backend: `{ type: 'chat', content: string }`; backend→frontend: `text_delta`, `text_done`, `error`, `conversation_updated`
  - `Conversation`, `ConversationWithMessages`, `ChatMessageRecord`
  - API response types
- `scripts/lint_module_boundaries.ts` — dependency direction enforcement. Include multi-level relative paths like `'../../db'` (CLARITY-024).
- `scripts/lint_db_encapsulation.ts` — DB queries only in `db/` layer
- `scripts/lint_async_hygiene.ts` — no blocking calls in server code
- `.husky/pre-commit` — run lint-staged
- `package.json` lint-staged config
- `.github/workflows/ci.yml` — lint + typecheck + arch checks + unit tests (2 parallel jobs)

**Reference:** `04_backend.md` (Error Handling section), `05_frontend.md` (Shared Types section), `10_dev_tooling.md` (full file — all three linter scripts, husky config, CI config)

**Verify:** Types compile. `AppError` can be instantiated with status + cause + `userFacing`. `pnpm run lint:arch` passes. `git commit` triggers lint-staged. CI workflow file is valid.

---

## Phase 2: Database Layer

Schema, migrations, connection, query functions, and bucket template seed. After this phase, the DB is fully operational and tested against real Postgres.

### Task 2.1: Schema, connection, and migrations

**Create:**
- `src/server/db/schema.ts` — all 8 tables from `03_data_layer.md` (buckets, bucket_templates, thread_buckets, email_threads, email_messages, google_tokens, conversations, chat_messages)
- `src/server/db/index.ts` — Drizzle client using `pg.Pool` (not raw connection string): `const pool = new Pool({ connectionString: process.env.DATABASE_URL! }); const db = drizzle(pool, { schema });`
- Initial migration via `pnpm drizzle-kit generate`
- Embed the `set_updated_at()` trigger in the initial generated migration (MIN-011) — do not create a separate numbered migration file that could collide with Drizzle's auto-numbering
- Seed migration for bucket templates (Executive, Sales, Engineering presets with 5 buckets each)

**Note:** Inspect the generated migration SQL to verify FK constraints — `thread_buckets.thread_id` references `email_threads.gmail_thread_id` (unique, not PK), which may generate unexpected SQL (FEAS-004).

**Reference:** `03_data_layer.md` (Drizzle Schema section, Migration Setup section, Database Connection section, bucket_templates seed data)

**Verify:** `docker compose up -d postgres`, `pnpm drizzle-kit migrate` succeeds, tables exist in DB, bucket templates are seeded.

### Task 2.2: Query functions + tests

**Create:**
- `src/server/db/queries.ts` — all query functions listed in `03_data_layer.md` Queries Needed section:
  - Google tokens: `getGoogleTokens`, `upsertGoogleTokens`
  - Bucket templates: `listBucketTemplates`, `getBucketTemplate`, `applyBucketTemplate` — validate JSONB with Zod schema (MIN-008), throw `AppError(409)` if buckets already exist
  - Buckets: `listBuckets`, `createBucket`, `updateBucket`, `deleteBucket`
  - Email sync: `upsertEmailThread`, `upsertEmailMessages`, `getEmailThread`, `listEmailThreads`, `listEmailThreadsByGmailIds`
  - Thread buckets: `listThreadsByBucket`, `assignThread`, `unassignThread`, `listBucketsWithThreads`
  - Batch bucketing: `getUnbucketedThreads`, `countUnbucketedThreads`, `assignThreadsBatch` — enforce 25-row cap, verify conflict target is correct unique column (FEAS-005)
  - Re-bucketing: `markAllForRebucket`, `getThreadsNeedingRebucket`, `clearRebucketFlag`
  - Conversations: `listConversations`, `getConversation`, `createConversation`, `updateConversation`, `deleteConversation`
  - Chat messages: `listMessagesByConversation`, `createChatMessage` (must explicitly `UPDATE conversations SET updated_at = NOW()` after insert — the trigger only fires on direct conversation updates, not transitively on chat_messages inserts)

**Tests** — `tests/unit/db/queries.test.ts` — integration tests against real Postgres:
- `applyBucketTemplate` throws 409 when buckets exist
- `createChatMessage` updates `conversations.updated_at`
- `assignThreadsBatch` respects 25-row cap
- `upsertEmailThread` handles conflict on `gmail_thread_id`

**Reference:** `03_data_layer.md` (Queries Needed section, full field definitions for each table)

**Verify:** `pnpm test` passes. All queries verified against real Postgres.

---

## Phase 3: Auth & Encryption

Google OAuth, token encryption, JWT sessions, cookie-based auth. After this phase, a user can log in and the backend has working auth middleware.

**Prerequisite:** GCP project setup must be complete (see Prerequisite section above).

### Task 3.1: Token encryption + Google OAuth client

**Create:**
- `src/server/crypto.ts` — AES-256-GCM encrypt/decrypt functions using Node `crypto` and `ENCRYPTION_KEY` env var. Key is 32 bytes (64 hex chars from `openssl rand -hex 32`), parsed via `Buffer.from(key, 'hex')`. Ciphertext stored as `<hex_iv>:<hex_ciphertext>`.
- `src/server/google/auth.ts` — `OAuth2Client` singleton, `getAuthClient()`, `persistTokens()` (encrypts before DB write, convert `expiry_date` epoch ms to `Date` explicitly — FEAS-011), `loadTokens()` (decrypts after DB read), token refresh listener that re-persists
- `src/server/google/index.ts` — re-exports

**Tests:**
- `tests/unit/crypto.test.ts` — encrypt/decrypt round-trip, different payloads, verify different ciphertexts for same plaintext (unique IVs)
- Unit test that `persistTokens` calls encrypt and `loadTokens` calls decrypt

**Reference:** `07_google_connectors.md` (section 4.1), `04_backend.md` (Token Sharing section)

**Verify:** `pnpm test` passes. Round-trip encryption works.

### Task 3.2: Auth routes + middleware

**Create:**
- `src/server/auth.ts` — all auth routes and middleware from `04_backend.md`:
  - `GET /auth/google` — initiate OAuth with scopes (gmail.modify, gmail.send, calendar, drive.readonly)
  - `GET /auth/google/callback` — exchange code, check allowlist, persist tokens, set httpOnly session cookie (`secure` conditional on `NODE_ENV`), redirect to `/`. On error, redirect to `/?auth_error=oauth_failed` — do NOT reflect raw Google error (SEC-002).
  - `GET /auth/status` — check session, return `{ authenticated, csrfToken }`
  - `GET /auth/logout` — clear cookie
  - `authMiddleware` — verify session cookie on `/api/*` and `/ws`, enforce `X-CSRF-Token` header on state-changing methods (POST/PUT/PATCH/DELETE). Use separate `CSRF_SECRET` env var (HIGH-9), not `JWT_SECRET`.
- Wire auth routes into `src/server/index.ts` — mount `/auth/*` as public routes, apply `authMiddleware` to `/api/*` and `/ws`

**Tests:**
- Unit test for allowlist rejection
- Unit test for CSRF enforcement

**Reference:** `04_backend.md` (Auth section — full code), `05_frontend.md` (Auth Check section)

**Verify:** Manual test: hit `/auth/google`, complete OAuth flow, verify httpOnly cookie set, verify `/auth/status` returns `{ authenticated: true, csrfToken }`, verify CSRF check rejects requests without header.

---

## Phase 4: SDK Spike

Before building connectors, tools, or the WebSocket handler, verify the Agent SDK assumptions the entire architecture depends on. This is a throwaway script — ~1 hour of work that could save days of rework.

### Task 4.1: Agent SDK verification

**Create:**
- `scripts/sdk_spike.ts` — a throwaway script that:
  1. Registers one dummy MCP tool via `createSdkMcpServer()` + `tool()`
  2. Calls `query()` and logs every message type, field, and shape
  3. Tests resume with a valid session ID
  4. Tests resume with a missing session ID — does it throw? hang? start fresh? (IMP-017)
  5. Measures whether `AssistantMessage` events arrive progressively (token-by-token) or as full blocks (HIGH-10)

**Verify answers to:**
- Does `message.session_id` exist? On which message type? (CLARITY-010)
- Does streaming give multiple `text_delta`-able events, or one big chunk? (HIGH-10)
- Does resume with a nonexistent session throw or silently start fresh? (IMP-017)
- What's the exact model string format? (CLARITY-002 / LOGIC-014)

**Update specs based on findings:**
- If streaming is not token-by-token, update `02_agent_spec.md` and `05_frontend.md` with the actual behavior
- If resume doesn't throw, update `04_backend.md` with the correct fallback logic
- Pin the verified model ID in `decisions_log.md`
- Record all findings in `project/design/issues_to_be_aware_of.md` (mark resolved items)

**Reference:** `02_agent_spec.md` (SDK Setup section), `04_backend.md` (WebSocket Chat Route section)

---

## Phase 5: Google Connectors

Thin wrappers around `googleapis`. Each connector is independent — tasks can be parallelized.

### Task 5.1: Gmail connector + tests

**Create:**
- `src/server/google/gmail.ts` — all methods from `07_google_connectors.md` section 4.2:
  - `getMessage`, `getThread`, `searchThreads` (add return type signature — CLARITY-021)
  - `sendMessage`, `replyToThread`, `createDraft`
  - `modifyLabels`, `markAsRead`, `archiveThread`, `listLabels`
  - Helper: MIME body decoder (walk `payload.parts` tree, base64url decode)
  - RFC 2822 construction via `mimetext`

**Tests** — `tests/unit/google/gmail.test.ts`:
- Decode base64url bodies, handle multipart messages, extract headers
- Mock `googleapis` for method shape tests

**Reference:** `07_google_connectors.md` (section 4.2, section 7 implementation notes)

### Task 5.2: Calendar connector + tests

**Create:**
- `src/server/google/calendar.ts` — all methods from `07_google_connectors.md` section 4.3:
  - `listEvents`, `getEvent`, `createEvent`, `updateEvent`, `deleteEvent`, `checkFreeBusy`
  - Helper: `parseEvent()` — normalize all-day vs timed events, extract attendees

**Tests** — `tests/unit/google/calendar.test.ts`:
- All-day events, attendee extraction, timezone handling

**Reference:** `07_google_connectors.md` (section 4.3)

### Task 5.3: Drive connector + tests

**Create:**
- `src/server/google/drive.ts` — all methods from `07_google_connectors.md` section 4.4:
  - `searchFiles`, `listRecentFiles`, `readDocument`, `getFileMetadata`
  - Query translation helper (friendly API → Drive search DSL)
  - Handle `files.export` 10MB limit with graceful error (FEAS-012)
  - No `readDocumentStructured` — deferred to v2

**Tests** — `tests/unit/google/drive.test.ts`:
- Query translation logic
- Mock `googleapis` for method shape tests

**Reference:** `07_google_connectors.md` (section 4.4, section 7 note on Drive search DSL)

### Checkpoint: Manual smoke test against real APIs

After all three connectors are built, verify against real Google APIs:
- Send a test email, verify it appears in Gmail
- List today's calendar events
- Search Drive for a known file
- Verify token refresh works (wait for expiry or force-refresh)

**Why:** Gmail body parsing is notoriously tricky (`payload.parts` nesting varies by content type). Better to find out now than when the email orchestration layer silently returns empty bodies.

---

## Phase 6: Email Orchestration

The most complex service-layer code, tested in isolation before wiring it into tools/routes.

### Task 6.1: Email orchestration layer + tests

**Create:**
- `src/server/email.ts` — all functions from `04_backend.md` (Email Orchestration Layer section):
  - `syncInbox(maxResults?)` — parallel fetching with `pLimit(5)`, diff-based. Note: snippet comparison may not work in all cases (IMP-014) — fall back to always fetching changed threads if needed. Add `extractBodyText(msg)` helper that returns `msg.bodyText` when non-empty and strips HTML from `msg.bodyHtml` as fallback — HTML-only emails (all promotional mail) have empty `bodyText` (IMP-020, confirmed Phase 5 smoke test). Apply to all `upsertEmailMessages` calls.
  - `search(query, maxResults?)` — uses same `pLimit(5)` concurrency pool as `syncInbox` (not a sequential for loop)
  - `getThread(gmailThreadId)`
  - `getUnbucketedThreads()`
  - `sendMessage`, `replyToThread`, `createDraft`, `archiveThread`, `markAsRead` — write operations that delegate to `gmail.ts`
  - Note: local variable in `search()` is named `resultLimit` (not `limit`) to avoid shadowing the module-level `pLimit` instance

**Tests** — `tests/unit/email.test.ts`:
- `syncInbox` diff logic (skips unchanged, fetches new)
- `search` syncs results to DB
- Parallel execution with `pLimit(5)`

**Reference:** `04_backend.md` (Email Orchestration Layer section, Diff-Based Sync Logic section)

**Verify:** `pnpm test` passes. Orchestration logic verified with mocked `gmail.ts` and `queries.ts`.

---

## Phase 7: MCP Tools + REST Routes

Wire service layers into the two consumer interfaces. Review issues are addressed inline.

### Task 7.1: MCP tools + tests

**Create:**
- `src/server/tools.ts` — all 5 tool definitions from `04_backend.md` (In-Process MCP Server section):
  - `buckets` — list, create (+ markAllForRebucket), update, delete, assign (batch, max 25)
  - `sync_email` — delegates to `email.ts`
  - `action_email` — send, reply, draft, archive, mark_read (delegates to `email.ts`, not `gmail.ts` directly)
  - `calendar` — list, get, create, update, delete, free_busy (delegates to `calendar.ts`)
  - `drive` — search, list_recent, read, metadata (delegates to `drive.ts`)

**Tests** — `tests/unit/tools.test.ts`:
- Action routing for all 5 tools
- Batch size enforcement (assign max 25)
- `buckets create` triggers `markAllForRebucket()`

**Reference:** `04_backend.md` (full tools.ts code block), `07_google_connectors.md` (tool specs section 5)

### Task 7.2: REST routes + tests

**Create:**
- `src/server/routes.ts` — all routes from `04_backend.md` (REST API section):
  - Register `POST /api/buckets/assign` **before** `PATCH /api/buckets/:id` (HIGH-8)
  - Gmail: `GET /gmail/threads`, `GET /gmail/threads/:id` (add response shape — CLARITY-018), `POST /gmail/send`, `POST /gmail/threads/:id/reply`, `POST /gmail/threads/:id/archive`, `POST /gmail/messages/:id/read` — add Zod request schemas for reply/archive/read (LOGIC-010)
  - Buckets: `GET /buckets`, `POST /buckets` (returns `rebucket_required: true`), `PATCH /buckets/:id`, `DELETE /buckets/:id`, `POST /buckets/assign`
  - Bucket templates: `GET /bucket-templates`, `GET /bucket-templates/:id`, `POST /bucket-templates/:id/apply`
  - Calendar: `GET /calendar/events`, `GET /calendar/events/:id`, `POST /calendar/events`, `PATCH /calendar/events/:id`, `DELETE /calendar/events/:id`
  - Conversations: `GET /conversations`, `GET /conversations/:id`, `POST /conversations`, `PATCH /conversations/:id`, `DELETE /conversations/:id`
  - Add Zod validation for GET query params (HIGH-5): `maxResults` as `z.coerce.number().int().min(1).max(25)`, `timeMin`/`timeMax` as `z.string().datetime()`, enforce max length on `q`
- Update `app.onError` in `src/server/index.ts` to use `AppError.userFacing` flag — only expose message when `userFacing` is true, otherwise return generic message (HIGH-4)

**Tests** — `tests/unit/routes.test.ts`:
- Hono `app.request()` test client (using `createApp({ skipAuth: true })` factory)
- Key routes: GET/POST buckets, GET threads, POST reply
- Zod validation rejects bad input (invalid `maxResults`, missing required fields)

**Reference:** `04_backend.md` (REST API section — full code for all routes, schemas)

**Verify:** `pnpm test` passes. Routes enforce validation. Error handler respects `userFacing` flag.

---

## Phase 8: Server + Agent WebSocket

Wire everything together. After this phase, the backend is fully functional. Adapt implementation based on Phase 4 spike findings.

### Task 8.1: Agent WebSocket handler

**Create:**
- `src/server/agent.ts` — from `04_backend.md` (WebSocket Chat Route section):
  - `SYSTEM_PROMPT` constant from `02_agent_spec.md` — skill file contents are appended at server startup
  - Agent SDK config (model string verified in Phase 4, system prompt, MCP server, subagent definitions)
  - `streamQuery()` — streams agent response over WebSocket, persists session ID and assistant message to Postgres. **Adapt streaming approach based on Phase 4 spike findings** (HIGH-10).
  - `handleWebSocket()` — extract `conversationId` from URL search params (HIGH-7: use `new URL(ws.url).searchParams.get('conversationId')`, not undefined `getQueryParam`), conversation lookup, session resume/create with fallback logic (adapted per Phase 4 spike — IMP-017), message handling
  - Incoming message validation with Zod schema (`{ type: 'chat', content: string }`)
  - Token streaming (`text_delta`, `text_done`)
  - Approval is chat-based — user confirms/declines via normal text messages ("go ahead", "no"), no special buttons or message types
  - Auto-title from first user message (sends `conversation_updated` WebSocket message)
  - Persist messages to Postgres

**Reference:** `04_backend.md` (WebSocket Chat Route — full code, Session Management section), `02_agent_spec.md` (System Prompt Design section, Skills section)

### Task 8.2: Server entry point + dev scripts

**Create:**
- `src/server/index.ts` — expand the minimal server from Phase 1 with full setup from `04_backend.md` (Hono Server Setup section):
  - Required env var validation (fail fast) — includes `GOOGLE_REDIRECT_URI`, `CSRF_SECRET` (HIGH-9)
  - Hono app with `createNodeWebSocket`
  - Central error handler (`app.onError` — ZodError, AppError with `userFacing` check, unexpected errors)
  - CSP headers middleware
  - Health check (`GET /health`)
  - Public routes: `/auth/*`
  - Static file serving (assets + SPA catch-all) — before auth
  - Auth middleware scoped to `/api/*` and `/ws` (with `Origin` header validation on WebSocket upgrade — CLARITY-014)
  - WebSocket route (`/ws`)
  - REST API routes (`/api/*`)
  - Server start with `serve()`
  - `injectWebSocket(server)`
  - SIGTERM graceful shutdown handler
- `scripts/dev.sh` — start Postgres, run migrations, start backend + frontend
- `scripts/migrate.sh` — run Drizzle migrations

**Reference:** `04_backend.md` (Hono Server Setup — full code), `06_tech_stack.md` (Scripts section)

**Verify:** `pnpm run dev` starts successfully. Health check returns `{ status: 'ok' }`. Unauthenticated requests to `/api/*` return 401. Static files served. WebSocket connects. Send a message, get a streamed response. Messages persist to Postgres.

---

## Phase 9: Frontend — App Shell + Chat Core

Establish the frontend foundation: auth flow, fetch wrapper, conversation management, and the chat interface. These are sequential — each builds on the previous — so they run in one context window without subagents.

### Task 9.1: App shell, auth flow, and fetch wrapper

**Create:**
- `src/client/main.tsx` — React root render
- `src/client/globals.css` — Tailwind base styles
- `src/client/App.tsx` — auth check on mount via `GET /auth/status`, redirect to `/auth/google` if not authenticated, store CSRF token in memory, layout skeleton (sidebar + center + right panel), `handleAgentDone` callback that triggers `refetch()` on all data hooks
- `src/client/lib/fetchApi.ts` — shared fetch wrapper with cookie-based auth (browser auto-attaches httpOnly cookie) + `X-CSRF-Token` header on state-changing requests (POST/PUT/PATCH/DELETE) + global 401 interceptor → redirect to `/auth/google`
- Initialize shadcn/ui (`npx shadcn@latest init`), add Button, Card, Spinner components

**Reference:** `05_frontend.md` (App Structure section, Auth Check section, fetchApi section)

**Verify:** App loads in browser. Unauthenticated user is redirected to Google login. After login, sees the layout skeleton.

### Task 9.2: ConversationList + useConversations hook

**Create:**
- `src/client/hooks/useConversations.ts` — fetch, create, update, delete conversations; exposes `refetch()` for `onAgentDone`; deduplicates in-flight fetches; includes `error` field in return value
- `src/client/components/ConversationList.tsx` — accepts `conversationsHook` as prop from App.tsx (HIGH-1 — single source of truth, not internal instance). Sidebar with conversation list, "New Chat" button, click to select, delete on hover

**Reference:** `05_frontend.md` (ConversationList section, Data Hooks section)

**Verify:** Conversations list loads from API. Can create new conversation. Can switch between conversations. Can delete.

### Task 9.3: Chat component + WebSocket

**Create:**
- `src/client/components/Chat.tsx` — full implementation from `05_frontend.md`:
  - Load message history from Postgres on conversation switch
  - WebSocket connection owned by Chat, scoped to conversation (`/ws?conversationId=xxx`), opens/closes on conversation switch
  - Token streaming — **adapt based on Phase 4 spike findings** (accumulate `text_delta` into current assistant message, finalize on `text_done`)
  - On `text_done`: call `onAgentDone()` to trigger data hook refetches across all panels
  - On `conversation_updated`: call `onTitleUpdate()` (typed as `() => void`) to refresh conversation list
  - Approval is chat-based — user types "go ahead" / "no" in normal text input, no special buttons
  - Input bar with send — **input and Send button disabled while `loading` is true** (no concurrent sends while streaming)
  - Empty state when no conversation selected — include "Start Day" button (CLARITY-027, LOGIC-008)
  - Connection lost banner + reconnect with exponential backoff

**Reference:** `05_frontend.md` (Chat Component section, WebSocket Client section — full code)

**Verify:** Can send a message and see agent response streaming. History loads on conversation switch. Data panels refresh after agent response completes.

---

## Phase 10: Frontend — Data Panels

BucketBoard and CalendarView are structurally identical (hook + board/list + detail panel) and independent of each other. **Run Tasks 10.1 and 10.2 as parallel subagents** — the patterns are established by Phase 9.

### Task 10.1: BucketBoard + ThreadDetail

**Create:**
- `src/client/hooks/useBuckets.ts` — fetch buckets with threads, create/update/delete bucket, assign thread; exposes `refetch()` for `onAgentDone`; deduplicates in-flight fetches; includes `error` field
- `src/client/components/BucketBoard.tsx` — kanban-style board, bucket columns, thread cards, empty state with template picker prompt
- `src/client/components/ThreadDetail.tsx` — full thread view (all messages), reply composer (sends `lastMessage.gmail_message_id` not `lastMessage.id`), archive button (calls `POST /api/gmail/threads/:id/archive` and triggers `bucketsHook.refetch()` via `onArchive` callback from App.tsx — LOGIC-006), auto-mark-read on open via `useEffect` (MIN-002)

**Reference:** `05_frontend.md` (BucketBoard section, ThreadDetail section, useBuckets hook)

**Verify:** Buckets display with thread cards. Click thread opens ThreadDetail. Can reply. Can archive (BucketBoard refreshes). BucketBoard refreshes when agent assigns threads (via `onAgentDone`).

### Task 10.2: CalendarView + EventDetail

**Create:**
- `src/client/hooks/useCalendarEvents.ts` — fetch today's events, create/update/delete events; exposes `refetch()` for `onAgentDone`; deduplicates in-flight fetches; includes `error` field
- `src/client/components/CalendarView.tsx` — today's events as cards, click to open EventDetail
- `src/client/components/EventDetail.tsx` — event info, inline edit form, delete with confirmation

**Reference:** `05_frontend.md` (CalendarView section, EventDetail section, useCalendarEvents hook)

**Verify:** Events display for today. Click event opens EventDetail. Can edit and save. Can delete. CalendarView refreshes when agent creates events (via `onAgentDone`).

---

## Phase 11: Agent Skills + First Launch

Wire up the agent skills and do end-to-end smoke testing. **Tasks 11.1 and 11.2 can be parallelized as subagents.**

### Task 11.1: Agent skills + system prompt refinement

**Create:**
- `.claude/skills/morning_briefing.md` — fan out to inbox review + meeting prep, synthesize briefing
- `.claude/skills/inbox_review.md` — sync, get unbucketed, classify in batches of 25, assign
- `.claude/skills/draft_reply.md` — read thread, draft reply, wait for approval
- `.claude/skills/meeting_prep.md` — read event, search related threads/docs, compile briefing

**Refine:**
- System prompt in `src/server/agent.ts` — ensure tool names match, approval instructions are clear, skill file contents appended at startup

**Reference:** `02_agent_spec.md` (Skills section — all 4 skills with detailed flows)

**Verify:** Manual end-to-end test: "Start Day" triggers morning briefing. "Review my inbox" triggers inbox review with batched classification. Agent respects chat-based approval flow for email sends.

### Task 11.2: First-launch template picker UI

**Create:**
- First-launch UI flow: detect empty buckets → show template picker → apply template → redirect to BucketBoard

**Reference:** `03_data_layer.md` (bucket_templates section), `08_architecture_diagrams.md` (First Launch Flow diagram)

**Verify:** Fresh database → first login → template picker appears → pick template → buckets created → BucketBoard shows empty buckets.

---

## Phase Summary

| Phase | Tasks | Subagent strategy | Depends On | Description |
|---|---|---|---|---|
| Prereq | 1 | — | — | GCP project setup (manual, before Phase 3) |
| 1. Scaffolding + Foundations | 2 | Parallel (independent files) | — | Configs, AppError, shared types, arch linters, git hooks, CI |
| 2. Database | 2 | Sequential (queries need schema) | Phase 1 | Schema, migrations, queries, template seed, integration tests |
| 3. Auth | 2 | Sequential (routes need crypto) | Phase 2 + Prereq | OAuth, encryption, cookie + CSRF auth (separate CSRF_SECRET) |
| 4. SDK Spike | 1 | Single task | Phase 3 | Verify streaming, resume, tool registration, model ID |
| 5. Connectors | 3 + checkpoint | **3 parallel subagents** (Gmail, Calendar, Drive) | Phase 3 | Connectors + unit tests + real API smoke test |
| 6. Email Orchestration | 1 | Single task | Phase 5 | syncInbox, search, getThread, write ops + tests |
| 7. Tools + Routes | 2 | **2 parallel subagents** (tools.ts, routes.ts) | Phase 6 | MCP tools, REST routes + Zod validation + tests |
| 8. Server + Agent | 2 | Sequential (index.ts mounts agent.ts) | Phase 4, 7 | WebSocket handler (adapted to spike), entry point, dev scripts |
| 9. App Shell + Chat | 3 | Sequential (each builds on previous) | Phase 8 | Auth flow, conversations, chat + WebSocket |
| 10. Data Panels | 2 | **2 parallel subagents** (buckets, calendar) | Phase 9 | BucketBoard + ThreadDetail, CalendarView + EventDetail |
| 11. Skills + First Launch | 2 | Parallel (independent) | Phase 10 | Agent workflows, template picker, E2E smoke test |
| **Total** | **24 tasks** | | | |

### Review issues addressed in-plan

| Issue | Where addressed |
|---|---|
| HIGH-4: AppError message leak | Task 1.2 (create with `userFacing`), Task 7.2 (wire into `app.onError`) |
| HIGH-5: GET param validation | Task 7.2 (Zod schemas for query params) |
| HIGH-7: undefined `getQueryParam` | Task 8.1 (use URL searchParams) |
| HIGH-8: Route registration order | Task 7.2 (register `/assign` before `/:id`) |
| HIGH-9: Separate CSRF_SECRET | Task 1.1 (.env.example), Task 3.2 (use in auth), Task 8.2 (REQUIRED_ENV) |
| HIGH-10: Streaming behavior | Task 4.1 (verify in spike), Task 8.1 + 9.3 (adapt) |
| SEC-002: OAuth error reflection | Task 3.2 (redirect to generic error) |
| SEC-006: SDK session PII | Task 1.1 (.gitignore) |
| IMP-017: SDK resume behavior | Task 4.1 (verify in spike), Task 8.1 (adapt) |
| CLARITY-002/LOGIC-014: Model ID | Task 4.1 (verify in spike) |
| CLARITY-010: session_id message type | Task 4.1 (verify in spike) |
| CLARITY-014: WebSocket CSRF | Task 8.2 (Origin header validation) |
| CLARITY-024: Multi-level linter paths | Task 1.2 (include in linter) |
| LOGIC-006: Archive doesn't refresh buckets | Task 10.1 (onArchive callback) |
| LOGIC-010: Reply/archive route schemas | Task 7.2 (add Zod schemas) |
| MIN-002: Auto-mark-read | Task 10.1 (useEffect in ThreadDetail) |
| MIN-008: Template JSONB untyped | Task 2.2 (Zod validation in query) |
| MIN-010: Biome version not pinned | Task 1.1 (pin in package.json) |
| MIN-011: Migration naming collision | Task 2.1 (embed trigger in initial migration) |
| FEAS-004: FK to non-PK column | Task 2.1 (inspect generated SQL) |
| FEAS-005: Batch upsert conflict target | Task 2.2 (verify in query + test) |
| FEAS-011: expiry_date conversion | Task 3.1 (explicit `new Date()`) |
| FEAS-012: Drive 10MB export limit | Task 5.3 (graceful error) |
| FEAS-013: Server tsconfig moduleResolution | Task 1.1 (override to node16) |
