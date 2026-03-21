# Issues to Be Aware Of During Implementation

Known gaps and ambiguities in the design docs. None block starting work — resolve each when you hit it.

**Source:** Items prefixed IMP/MIN are from the original design process. Items with review IDs (HIGH-x, SEC-x, etc.) come from the [design review](../../spec_review/second_try/design_review.md).

---

## Important — Fix During Implementation

### HIGH-4: AppError message passthrough leaks internals (SEC-001)

`AppError.message` is passed directly into HTTP responses via `c.json({ error: err.message }, err.status)`. If any `AppError` includes internal details (DB IDs, SQL fragments, googleapis error strings), they reach the client.

**Fix:** Add a `userFacing: boolean` flag to `AppError`. Only expose `err.message` when `userFacing` is true; otherwise return a generic message and log details server-side.

**Where:** `src/server/exceptions.ts`, `src/server/index.ts` — `app.onError` handler

### HIGH-5: GET route query params lack Zod validation (SEC-008, SEC-009)

POST bodies are well-validated with Zod, but GET query params (`?q=`, `?timeMin=`, `?timeMax=`, `?maxResults=`) are passed directly to Google APIs without validation.

**Fix:** Add Zod schemas for GET route query params. Validate `maxResults` as `z.number().int().min(1).max(100)`, `timeMin`/`timeMax` as `z.string().datetime()`, and enforce a max length on `q`.

**Where:** `src/server/routes.ts` — Gmail and Calendar GET routes

### HIGH-7: `getQueryParam(ws, 'conversationId')` undefined (CLARITY-011)

The WebSocket handler calls `getQueryParam(ws, 'conversationId')` but this function is never defined. Hono's WebSocket upgrade doesn't expose a query parameter helper on the `ws` object.

**Fix:** Use `const url = new URL(ws.url); const conversationId = url.searchParams.get('conversationId');` or extract from the upgrade request context.

**Where:** `src/server/agent.ts` — `handleWebSocket()`

### HIGH-8: Route registration order for `/buckets/assign` (CLARITY-013)

`POST /api/buckets/assign` is registered after `PATCH /api/buckets/:id`. The dynamic `:id` segment could match "assign" depending on Hono's routing rules.

**Fix:** Register `POST /api/buckets/assign` before any `/:id` routes, or confirm Hono handles literal-before-dynamic automatically.

**Where:** `src/server/routes.ts`

### HIGH-9: Separate CSRF_SECRET from JWT_SECRET (SEC-005)

`JWT_SECRET` does double duty: signs JWTs and generates CSRF tokens via HMAC. One leaked secret compromises both.

**Fix:** Use a separate `CSRF_SECRET` env var. Add it to the `REQUIRED_ENV` startup check.

**Where:** `src/server/auth.ts`, `src/server/index.ts` — env validation

### HIGH-10: Streaming may not be token-by-token (FEAS-003)

The SDK's `AssistantMessage` type may emit full content blocks, not individual tokens. The `text_delta` WebSocket messages could deliver one large chunk at a time, not the smooth typing effect depicted in wireframes.

**Fix:** Verify whether the SDK emits multiple progressive `AssistantMessage` events during a single turn. If not, adjust frontend expectations or use the Anthropic API directly for token streaming.

**Where:** `src/server/agent.ts` — `streamQuery()`

### SEC-002: OAuth callback reflects raw Google error in redirect URL

If the OAuth callback receives an error from Google, the current design reflects the raw error string in the redirect URL, potentially leaking internals.

**Fix:** Redirect to `/?auth_error=oauth_failed` with a generic error code instead of reflecting the raw error.

**Where:** `src/server/auth.ts` — `GET /auth/google/callback`

### SEC-006: SDK session .jsonl files accumulate plaintext PII

In local dev, the Agent SDK writes session files (`.jsonl`) that may contain plaintext email content, calendar details, etc.

**Fix:** Add `~/.claude/projects/` to `.gitignore`. Document cleanup procedure for local dev.

### IMP-014: syncInbox snippet comparison may not work (FEAS-008)

`syncInbox` diffs local vs Gmail using `snippet` comparison. Gmail `threads.list` may not return `snippet` in all cases. If it doesn't, fall back to always fetching changed threads (slightly less efficient but correct). History ID-based incremental sync is the proper fix — deferred to v2.

**Where:** `src/server/email.ts` — `syncInbox()`

### ~~IMP-015: useConversations data_changed never emitted~~ RESOLVED

No longer applicable — the `data_changed` event system has been removed. Data hooks refetch when `text_done` arrives (via `onAgentDone` callback). Auto-title updates reach the frontend via the `conversation_updated` WebSocket message, which triggers `conversationsHook.refetch()` via `onTitleUpdate`.

### IMP-016: Rebucketing only happens through the agent

Only the agent (via the `buckets create` tool) triggers `markAllForRebucket()`. The REST `POST /api/buckets` route does **not** call `markAllForRebucket()` — it returns `rebucket_required: true` so the frontend can prompt the user to ask the agent to re-sort. This keeps the agent as the single actor for thread classification.

**Where:** `src/server/tools.ts` — `buckets` handler, `create` action; `src/server/routes.ts` — `POST /api/buckets`

### IMP-017: SDK session resume behavior unknown (LOGIC-011)

The design assumes `new Agent({ resume: 'nonexistent-id' })` throws when the session file is missing, and the catch block creates a fresh session. This hasn't been verified. If it hangs or no-ops instead of throwing, the fallback logic breaks.

**Fix:** Test this early when wiring up the Agent SDK. If it doesn't throw, add a `Promise.race` with 30s timeout or check for session file existence before attempting resume.

**Where:** `src/server/agent.ts` — session initialization in `handleWebSocket()`

### LOGIC-006: Archive from direct UI doesn't refresh BucketBoard

When a user archives a thread from `ThreadDetail`, the `BucketBoard` doesn't know to remove that thread from its display.

**Fix:** Pass an `onArchive` callback from `App.tsx` that triggers `bucketsHook.refetch()`.

**Where:** `src/client/components/ThreadDetail.tsx`, `src/client/App.tsx`

### LOGIC-010: REST route schemas for reply/archive/read never designed

The route table lists `POST /gmail/threads/:id/reply`, `POST /gmail/threads/:id/archive`, and `POST /gmail/messages/:id/read` but their request/response schemas are not specified in `04_backend.md`.

**Fix:** Add Zod request schemas and response shapes for these routes during implementation.

**Where:** `src/server/routes.ts`

---

## Medium — Verify When You Hit It

### CLARITY-002 / LOGIC-014: Model ID needs verification

The spec uses `"claude-opus-4-6"` as the model identifier. Verify the exact model string accepted by the Agent SDK before hardcoding.

**Where:** `src/server/agent.ts`

### CLARITY-010: Which SDK message type carries session_id

The spec says to extract `session_id` from the SDK response but doesn't specify which message type contains it. Inline the relevant message shape when implementing.

**Where:** `src/server/agent.ts` — `streamQuery()`

### CLARITY-014: WebSocket CSRF — sameSite: Strict sufficiency

The design relies on `sameSite: Strict` cookies for WebSocket auth but doesn't confirm this is sufficient (WebSocket upgrades may not respect SameSite in all browsers).

**Fix:** Add `Origin` header validation on WebSocket upgrade, or verify `sameSite: Strict` is sufficient.

**Where:** `src/server/auth.ts` — auth middleware for `/ws`

### CLARITY-018: Thread detail response shape unspecified

`GET /api/gmail/threads/:id` response shape (messages array, header fields, body format) is not documented in the route table.

**Fix:** Add a response shape example when implementing.

**Where:** `src/server/routes.ts`, `05_frontend.md`

### CLARITY-021: searchThreads return type and snippet availability

The Gmail connector's `searchThreads` method lacks a documented return type. Also unclear whether snippets are available in search results.

**Where:** `src/server/google/gmail.ts`

### CLARITY-027: "Start Day" button ownership and prerequisites

The "Start Day" button appears in wireframes but has no component spec. Unclear whether it lives in Chat's empty state or as a standalone component, and what prerequisites it checks (e.g., buckets must exist).

**Fix:** Add empty-state branch to Chat component during frontend implementation.

**Where:** `src/client/components/Chat.tsx`

### LOGIC-002: Tool count says "6" in tech_stack.md, actual is 5

`06_tech_stack.md` mentions 6 MCP tools but only 5 are defined.

**Fix:** Correct the count to 5.

**Where:** `project/design/06_tech_stack.md`

### LOGIC-012: Window focus refetch promised but not designed

The decisions log says hooks refetch on window focus, but no hook spec includes `visibilitychange` or `focus` listeners.

**Fix:** Add to hook implementations or remove the claim from the decisions log.

**Where:** `src/client/hooks/`, `project/design/decisions_log.md`

### LOGIC-013: Architecture diagram shows duplicate Google API boxes

`08_architecture_diagrams.md` has two separate Google API boxes in the system overview diagram.

**Fix:** Simplify to one set during any diagram update.

### ~~FEAS-004: Drizzle FK to non-PK unique column may generate unexpected SQL~~ RESOLVED

Drizzle generated the `ALTER TABLE ADD CONSTRAINT FOREIGN KEY` statements for `email_messages` and `thread_buckets` *before* the `CREATE UNIQUE INDEX` on `email_threads.gmail_thread_id`. Postgres requires the unique index to exist before accepting a FK that references it. Fixed by manually reordering the initial migration to create `email_threads_gmail_thread_id_idx` before any FK constraints that reference it.

### ~~FEAS-005: Batch upsert conflict target must be unique column~~ RESOLVED

`assignThreadsBatch` uses `onConflictDoUpdate({ target: threadBuckets.gmail_thread_id, ... })` which correctly targets the unique index on that column. 25-row cap enforced via `if (assignments.length > BATCH_SIZE) throw AppError(400)`. Verified by test.

### FEAS-011: expiry_date epoch ms to Date conversion must be explicit

Google OAuth returns `expiry_date` as epoch milliseconds. The schema stores it as a `timestamp`. The conversion must use `new Date(tokens.expiry_date)` explicitly.

**Where:** `src/server/google/auth.ts` — `persistTokens()`

### FEAS-012: Drive files.export 10MB limit needs graceful handling

Google Drive `files.export` has a 10MB limit on exported content. Large documents will fail silently or error.

**Fix:** Catch the error and return a descriptive message to the user.

**Where:** `src/server/google/drive.ts` — `readDocument()`

### FEAS-013: Server tsconfig inherits moduleResolution "bundler"

The base `tsconfig.json` uses `"moduleResolution": "bundler"` which is for Vite. The server needs `"node16"` or `"nodenext"`.

**Fix:** Override `moduleResolution` in `tsconfig.server.json`.

### CLARITY-024: Architecture linter misses multi-level relative paths

The module boundary linter checks for `'../db'` but would miss `'../../db'` or deeper relative imports.

**Fix:** Add multi-level relative patterns to the forbidden imports list.

**Where:** `scripts/lint_module_boundaries.ts`

---

## Minor — Fix As You Go

### ~~MIN-001: Archive operates on single message, not thread~~ RESOLVED

Archive is now thread-level throughout: `archiveThread(threadId)` uses `threads.modify` to remove `INBOX` label from the entire thread. Routes use `POST /api/gmail/threads/:id/archive`. The `action_email` MCP tool uses `thread_id` for archive.

### MIN-002: ThreadDetail auto-mark-read described but not coded

The frontend spec says ThreadDetail should auto-mark-read on open via `POST /api/gmail/messages/:id/read`, but the conceptual component code doesn't include this call.

**Fix:** Add a `useEffect` that calls mark-read when `threadId` changes.

**Where:** `src/client/components/ThreadDetail.tsx`

### MIN-003: getThread always re-fetches from Gmail (no cache check)

`email.getThread()` always calls `gmail.getThread()` even if the thread is already cached and fresh. Acceptable for v1 — ensures data is always current. Optimize later if it causes latency issues.

**Where:** `src/server/email.ts` — `getThread()`

### MIN-007: First Launch template picker unclear in wireframes

The flow for picking a bucket template on first launch is described in the system overview and architecture diagrams but lacks a concrete component spec or wireframe.

**Fix:** Build a simple modal/page during frontend implementation. The API endpoints (`GET /api/bucket-templates`, `POST /api/bucket-templates/:id/apply`) are already designed.

### ~~MIN-008: Bucket template JSONB shape is untyped~~ RESOLVED

`applyBucketTemplate` validates `template.buckets` with `BucketDefinitionSchema` (Zod array of `{ name, description, sort_order }`) before inserting. Invalid JSONB throws a ZodError at call time.

### MIN-009: Architecture linter bypass via barrel re-exports

The regex-based module boundary linter (`lint_module_boundaries.ts`) checks import paths but can be bypassed if a barrel `index.ts` re-exports from a forbidden module. Low risk — the team is one person.

### MIN-010: Biome version not pinned

`biome.json` references `schemas/2.0.x` but `package.json` doesn't pin a specific Biome version.

**Fix:** Pin to a specific version in `package.json` devDependencies during setup.

### ~~MIN-011: Drizzle manual migration naming may collide~~ RESOLVED

Both the `set_updated_at()` trigger and the bucket template seed data were embedded directly into the Drizzle-generated `0000_perfect_steve_rogers.sql` migration. No separate migration file was created, so there is no numbering collision risk.

### MIN-013: No documented rule for orchestration layers

`email.ts` is an orchestration layer between connectors and queries, but this pattern isn't documented as a general rule. If calendar or drive needs similar orchestration later, developers might put the logic elsewhere.

**Fix:** Add a note to `agent_docs/backend-patterns.md` when it's created.

### MIN-014: ThreadDetail/EventDetail call fetch directly

These components call `fetch()` directly instead of using a shared hook. Acceptable for v1 — they're detail panels with one-off fetches, not shared data sources.

### MIN-015: getAuthClient() initialization contract implicit

`getAuthClient()` creates a module-level singleton that loads tokens from Postgres. The contract (must be called after DB is ready, returns null if no tokens) is implicit.

**Fix:** Add a JSDoc comment documenting the contract during implementation.

**Where:** `src/server/google/auth.ts`

### FEAS-006: Repeated countUnbucketedThreads queries during classification

During batch bucketing, `countUnbucketedThreads` is called after each batch to check if more remain. Acceptable for v1 — cache the count if latency becomes an issue.

**Where:** `src/server/tools.ts` — `buckets` handler

### SEC-011: SDK session IDs stored in Postgres (informational)

Session IDs are stored in the `conversations` table. These are opaque identifiers, not secrets, but worth noting for awareness.

**Where:** `src/server/db/schema.ts` — `conversations` table
