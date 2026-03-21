# Architecture Review — Full Spec Review

Review of all docs in `project/design/` for logic consistency, architecture quality, and technical feasibility. Conducted 2026-03-21.

---

## Blockers — Must Fix Before Implementation

### ~~BLOCK-001: Agent SDK API surface is unverified~~ RESOLVED

Researched the actual SDK. Rewrote `agent.ts` to use `query()` async generator pattern instead of `new Agent()` class. Rewrote `tools.ts` to use `tool()` helper with Zod schemas instead of raw JSON Schema objects. Updated `decisions_log.md` with correct SDK API notes.

---

### ~~BLOCK-002: No mechanism for emitting `awaiting_approval` to the frontend~~ RESOLVED

This was a false positive. The approval flow was already designed as purely chat-based (no `awaiting_approval` message type). The agent describes the action and asks for confirmation in natural language; the user replies in natural language. No special protocol message needed. Confirmed across `08_architecture_diagrams.md` diagram 3 and `05_frontend.md`.

---

### ~~BLOCK-003: Approve/reject handlers don't stream and don't persist~~ RESOLVED

Replaced the separate `approve`/`reject` branches with the shared `streamQuery()` function. All three paths (`chat`, approve, reject) now stream via the same async generator loop and persist via `createChatMessage()`.

---

### ~~BLOCK-004: `handleWebSocket` is sync but uses `await`~~ RESOLVED

Moved all async initialization (conversation lookup, session management) into the `ws.on('message')` handler. The `handleWebSocket` function is now sync — it only sets up event listeners and returns immediately.

---

### ~~BLOCK-005: `session.close()` contradicts "don't destroy session"~~ RESOLVED

Removed `session.close()` from both the `handleWebSocket` close handler and the `data change events` example code block.

---

### ~~BLOCK-006: Deployment doc contradicts all other docs on message persistence~~ RESOLVED

Changed `09_deployment.md` to: "SDK session context (agent working memory) is lost on scale-to-zero; the agent starts with a fresh context. Chat message history is preserved in Postgres and remains visible in the UI."

---

## Important — Will Cause Bugs or Friction

### ~~IMP-001: `action_email` tool bypasses `email.ts` orchestration layer~~ RESOLVED

Updated `tools.ts` to delegate all email writes through `email.ts` (e.g., `email.sendMessage`, `email.replyToThread`, etc.). Added write methods to `email.ts`.

---

### ~~IMP-002: `routes.ts` email writes also bypass `email.ts`~~ RESOLVED

Updated `routes.ts` to call `email.*` instead of `gmail.*` for all email write routes. Removed the `gmail` import from routes.ts.

---

### ~~IMP-003: `POST /api/buckets` missing side effects~~ RESOLVED

Added `queries.markAllForRebucket()` and `emitDataChanged('buckets')` to the `POST /api/buckets` route. Also added `emitDataChanged('buckets')` to PATCH, DELETE, and assign routes.

---

### ~~IMP-004: `emitDataChanged` not called from REST routes~~ RESOLVED

Added `import { emitDataChanged } from './events'` to routes.ts and `emitDataChanged('buckets')` calls to all bucket mutation routes.

---

### ~~IMP-005: `WebSocketContext` never defined~~ RESOLVED

Added `WebSocketProvider` definition to `05_frontend.md`. WebSocket connection is now owned by the provider (wrapping authenticated App), not by Chat.tsx. Updated Chat component to use `useContext(WebSocketContext)` instead of local `wsRef`. Updated WebSocket protocol section to reflect app-level connection lifecycle.

---

### ~~IMP-006: OAuth scopes missing `openid`/`email`~~ NOT AN ISSUE

The auth.ts code block already included `openid` and `userinfo.email` scopes. This was a false positive from the review.

---

### ~~IMP-007: `expiry_date` type mismatch~~ RESOLVED

Added a comment to the schema in `03_data_layer.md` documenting that googleapis returns `expiry_date` as epoch ms and must be converted with `new Date()` before upserting.

---

### ~~IMP-008: `ALLOWED_USERS` uses fallback default~~ RESOLVED

Changed `ALLOWED_USERS` and `JWT_SECRET` to use fail-fast pattern with explicit `throw new Error('Missing required env var: ...')` instead of `|| ''` and `!` assertion.

---

### ~~IMP-009: Subagent contradiction~~ NOT AN ISSUE

The claim "Single agent in v1 — no subagents" does not exist in the docs. The spec consistently uses subagents throughout `02_agent_spec.md` and `decisions_log.md`. The Agent SDK supports an `agents` config option. This was a false positive.

---

### ~~IMP-010: Table count mismatch~~ RESOLVED

Fixed `06_tech_stack.md` from "9 tables" to "8 tables" to match `03_data_layer.md` and `01_system_overview.md`.

---

### ~~IMP-011: Auth diagram says "persist to disk"~~ RESOLVED

Changed `08_architecture_diagrams.md` step 4 from "persist tokens to disk" to "persist tokens to Postgres".

---

### ~~IMP-012: Missing FK constraints on email tables~~ RESOLVED

Added `.references(() => emailThreads.gmail_thread_id, { onDelete: 'cascade' })` to `email_messages.gmail_thread_id` and `thread_buckets.gmail_thread_id` in `03_data_layer.md`.

---

### ~~IMP-013: Auth middleware swallows exceptions~~ RESOLVED

Added `console.warn` logging to both the `/auth/status` catch block and the `authMiddleware` catch block.

---

### IMP-014: `syncInbox` snippet comparison may not work

**Files:** `04_backend.md` (email.ts), `07_google_connectors.md`

**Status: OPEN** — Needs verification during implementation.

Uses `local.snippet !== thread.snippet` as the staleness check. Gmail `threads.list` may not reliably return the snippet field. If absent, `isChanged` will always be false for existing threads, meaning updates to known threads will never be detected.

**Fix:** Verify during implementation that `threads.list` returns snippet. If not, use `historyId` for change detection (the `gmail_history_id` field already exists for this).

---

### IMP-015: `useConversations` data_changed entity never emitted

**Files:** `05_frontend.md`, `04_backend.md`

**Status: OPEN** — Needs decision.

`DataChangedEntity` includes `'conversations'` and `useConversations` subscribes to it, but no tool handler or route ever calls `emitDataChanged('conversations')`.

**Fix:** Either add `emitDataChanged('conversations')` to relevant code paths, or remove the subscription if conversation changes always happen via direct user action with local refetch.

---

### IMP-016: Bucket tool handler has inline business logic

**Files:** `04_backend.md` (tools.ts)

**Status: OPEN** — Acceptable for v1, consider extracting later.

The `buckets` tool handler calls `queries.markAllForRebucket()` after `createBucket`, assembles compound return values, and enforces `BATCH_SIZE`. This is more than thin delegation, but the same logic is now consistently applied in both tools and routes.

---

### IMP-017: SDK session resume on Railway ephemeral filesystem

**Files:** `04_backend.md`, `09_deployment.md`

**Status: OPEN** — Needs verification during implementation.

Session files are lost on every Railway redeploy and scale-to-zero. The fallback (start fresh when resume fails) is correct, but it depends on the SDK's behavior when `resume` references a nonexistent session. The new `streamQuery()` function passes `resume: sessionId` as an option to `query()` — verify that this gracefully handles missing session files.

---

## Minor — Low Risk / Cosmetic

### MIN-001: Archive action operates on single message, not thread

**Status: OPEN** — Clarify intent during implementation.

`POST /api/gmail/messages/:id/archive` archives a single message by message ID. If thread-level archive is intended, use `threads.modify`.

---

### MIN-002: ThreadDetail auto-mark-read described but not in code

**Status: OPEN** — Add during implementation.

Spec says "Mark read — auto on open" but component code has no call to the read endpoint.

---

### MIN-003: `getThread` always re-fetches from Gmail

**Status: OPEN** — Acceptable for v1.

Always calls Gmail API with no cache check. For a detail view, always-fresh is defensible but inconsistent with sync-first design.

---

### ~~MIN-004: `ConversationList.handleDelete` uses `?? null` fallback~~ RESOLVED

Changed to filter out the deleted conversation and select from the remaining list.

---

### ~~MIN-005: `createConversation` route uses fallback default~~ RESOLVED

Made `title` required in the Zod schema (removed `.optional()`). Route passes `body.title` directly.

---

### ~~MIN-006: `/auth/status` swallows catch block~~ RESOLVED

Fixed as part of IMP-013 — added `console.warn` logging.

---

### MIN-007: First Launch flow unclear in wireframes

**Status: OPEN** — Low priority, clarify if confusion arises.

Where does the bucket template picker appear in the UI? Is it a modal, a separate screen, or inline?

---

### MIN-008: Bucket template JSONB shape is untyped

**Status: OPEN** — Add Zod parsing during implementation.

Define a `BucketDefinition` type in `src/shared/types.ts` and parse JSONB when reading templates.

---

### MIN-009: Architecture linter bypass via barrel re-exports

**Status: OPEN** — Low priority.

Regex-based linter won't catch imports through `index.ts` barrel files.

---

### MIN-010: Biome version not pinned to match schema

**Status: OPEN** — Fix in `package.json` during project setup.

Pin `@biomejs/biome` to `^2.0.0`.

---

### MIN-011: Drizzle manual SQL migration naming may collide

**Status: OPEN** — Fix during migration setup.

Use `0000_` prefix for the manual `updated_at` trigger migration.

---

### MIN-012: `agent.ts` mixes session lifecycle and message dispatch

**Status: RESOLVED** — The rewrite already extracts session management into the `streamQuery()` helper. `handleWebSocket` is now a thin message dispatcher.

---

### MIN-013: No documented rule for when to introduce an orchestration layer

**Status: OPEN** — Low priority.

Document the rule: "Orchestration layers exist when a feature coordinates between a Google connector and the DB layer."

---

### MIN-014: `ThreadDetail`/`EventDetail` call `fetch` directly

**Status: OPEN** — Acceptable for v1.

Inconsistent with the hook pattern but detail panels are one-off fetchers with no agent-write refetch trigger.

---

### MIN-015: `getAuthClient()` initialization contract is implicit

**Status: OPEN** — Document during implementation.

Document that `getAuthClient()` returns the client regardless of token state.
