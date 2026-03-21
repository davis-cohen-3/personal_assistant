# Clarity Review

Ambiguous sections, missing details, and places where a developer would need to guess during implementation.

---

## High Priority (would block or confuse implementation)

### CLARITY-004: Skill Loading Mechanism Undefined ✅ RESOLVED

`02_agent_spec.md` defines skills as "workflow definitions stored in `.claude/skills/`" but never explains how skill content reaches the agent. Options: included in `SYSTEM_PROMPT` at startup, injected per-message, read from disk at runtime via a tool. A developer implementing `agent.ts` has no guidance.

**Fix:** Add: "The contents of each skill file are appended to `SYSTEM_PROMPT` in `agent.ts` at server startup."

---

### CLARITY-009: conversationId Delivery Contradiction

See **CRIT-001** in `01_critical_issues.md`. Backend reads query param, frontend sends `set_conversation` message, Zod schema rejects it.

---

### CLARITY-013: Reply Endpoint messageId Type Ambiguity ✅ RESOLVED

The `replySchema` requires `messageId: z.string()`. The `ThreadDetail` component sends `lastMessage.id` — but is this the Postgres UUID or the `gmail_message_id`? The Gmail API's `In-Reply-To` header requires a Gmail message ID, not a Postgres UUID.

**Fix:** Document which field `GET /api/gmail/threads/:id` returns for each message, and which field the frontend should pass as `messageId`.

**Affected docs:** `04_backend.md`, `05_frontend.md`

---

### CLARITY-014: Bearer Token Page Refresh

See **CRIT-002** in `01_critical_issues.md`.

---

### CLARITY-021: Encryption Key Size Math Wrong

`07_google_connectors.md` says AES-256-GCM. `.env.example` says `openssl rand -hex 32`. That produces 32 hex chars = 16 raw bytes = AES-128, not AES-256.

**Fix:** Specify: "ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Generate via `openssl rand -hex 32`." Note: `openssl rand -hex 32` outputs 64 hex chars encoding 32 bytes — the current wording is actually correct if interpreted as "32 bytes of randomness output as hex." Clarify the distinction.

---

## Remaining Findings

### CLARITY-001: Agent Tool Count Ambiguity

`02_agent_spec.md` says "5 tools" but also mentions the `Agent` tool for subagents. Is that a 6th MCP tool or an implicit SDK capability?

**Fix:** State whether `Agent` is registered in `createCustomMcpServer()` or is an SDK-provided capability.

---

### CLARITY-002: Subagent Configuration Missing

No code example showing how to spawn a subagent on Haiku. What model string? What API call?

**Fix:** Add a concrete code snippet for subagent spawning, including model name.

---

### CLARITY-003: Re-bucketing — No Tool to Clear Flag

The re-bucketing skill says "Clear the rebucket flag for processed threads" but no tool exposes `clearRebucketFlag`.

**Fix:** State that `buckets assign` automatically sets `needs_rebucket = false` as a side effect.

---

### CLARITY-005: Inbox Review — Unbucketed Count Not in Sync Response

The skill says "if unbucketed > 0" but `sync` only returns `{ new: N, updated: N }`. The agent can't know the unbucketed count before calling `get_unbucketed`.

**Fix:** Revise: "After sync, call get_unbucketed. If count is 0, stop."

---

### CLARITY-006: applyBucketTemplate Duplicate Handling

What happens if buckets with the same names already exist? Upsert, skip, or throw?

**Fix:** Document the conflict behavior explicitly.

---

### CLARITY-007: assignThreadsBatch Upsert Behavior

Does the batch upsert overwrite existing bucket assignments (last-write-wins) or skip conflicts?

**Fix:** Add: "ON CONFLICT (gmail_thread_id) DO UPDATE SET bucket_id = EXCLUDED.bucket_id"

---

### CLARITY-008: WebSocket Object Type Mismatch ✅ RESOLVED

`handleWebSocket` uses `ws.on('message', ...)` but `@hono/node-ws` provides `WSContext` which may use `ws.onmessage` instead.

**Fix:** Show the exact function signature matching what `upgradeWebSocket` expects.

---

### CLARITY-010: Conversation Title Required But Not Provided

See **CRIT-007** in `01_critical_issues.md`.

---

### CLARITY-011: Calendar timeMax Default Undefined ✅ RESOLVED

If `timeMax` is not provided to `GET /api/calendar/events`, what does `listEvents` do? No upper bound means potentially months of events.

**Fix:** Default `timeMax` to end of current day. Document in both the route and the connector spec.

---

### CLARITY-012: Archive Endpoint — Thread vs Message ✅ RESOLVED

`routes.ts` has `/threads/:id/archive` (thread-level). `08_architecture_diagrams.md` shows `/messages/:id/archive` (message-level). `issues_to_be_aware_of.md` MIN-001 flags the contradiction.

**Fix:** Align the architecture diagram with routes.ts. Resolve MIN-001 explicitly.

---

### CLARITY-015: useConversations Hook Signature

`createConversation()` is called with no arguments but must POST a `{ title }` body.

**Fix:** Show the function signature including any default title value.

---

### CLARITY-016: text_done Ordering Guarantee

Is there a guarantee that `text_done` arrives after all `text_delta` events? Could React batching cause issues?

**Fix:** Document the ordering guarantee (or lack thereof) for the WebSocket event stream.

---

### CLARITY-017: Data Hooks Use Raw fetch Instead of fetchApi

Hook mutations call `fetch()` directly instead of `fetchApi()`, so they don't attach the Bearer token.

**Fix:** Replace all `fetch(...)` in hooks with `fetchApi(...)`.

---

### CLARITY-019: conversations in DataChangedEntity Never Emitted

`DataChangedEntity` includes `'conversations'` but `emitDataChanged('conversations')` is never called (except auto-title). Flagged in IMP-015.

**Fix:** Either fix IMP-015 or remove `'conversations'` from `DataChangedEntity`.

---

### CLARITY-020: Google Docs Scope — Open Decision ✅ RESOLVED

"We can drop `documents.readonly` in v1 if plain-text export via Drive is enough." The auth routes don't include it, but `07_google_connectors.md` leaves it open.

**Fix:** Make a firm decision. Since auth doesn't include the scope, defer `readDocumentStructured` to v2.

---

### CLARITY-022: listMessages Has No Caller ✅ RESOLVED

`gmail.ts` defines `listMessages` but `email.ts` uses `searchThreads`. No code calls `listMessages`.

**Fix:** Remove from spec or document a caller.

---

### CLARITY-023: Architecture Diagram Shows Duplicate Connector Boxes

Diagram 1 shows two separate `google/* connectors` boxes, suggesting two instances. They're singletons.

**Fix:** Show one shared box with arrows from both `agent.ts` and `routes.ts`.

---

### CLARITY-024: Build Command — Migration Rollback Risk

Railway runs `pnpm run build && pnpm drizzle-kit migrate`. If build fails after migrations ran, schema changes are applied to production with no rollback.

**Fix:** Move migrations to the start command, or document that migrations are append-only.

---

### CLARITY-025: Scale-to-Zero vs WebSocket

Does Railway consider an open WebSocket as "activity" that prevents sleep? Or does it sleep after 5 min regardless?

**Fix:** Clarify the exact trigger and document a keep-alive ping if needed.

---

### CLARITY-026: Route Test Auth Bypass Unimplemented

"Route tests bypass auth middleware" is mentioned but neither a `NODE_ENV=test` check nor a test helper is defined.

**Fix:** Show the concrete implementation for test auth bypass.

---

### CLARITY-027: tools.test.ts Imports Non-Existent Function

Test example imports `handleBuckets` directly from `tools.ts`, but tools.ts only exports `createCustomMcpServer()`.

**Fix:** Either export handler functions for testability or revise the test pattern.

---

### CLARITY-029: "Start Day" Button Conditions

The wireframe shows a "Start Day" button but no component or condition for rendering it is specified.

**Fix:** Add: "When `conversations.length === 0` and `activeConversationId === null`, Chat.tsx renders the Start Day state."

---

### CLARITY-030: Mobile Layout Unspecified ✅ RESOLVED

"On narrow screens, the data panels could stack below the chat" — speculative, not a decision.

**Fix:** "Mobile layout is out of scope for v1. The app targets desktop-width screens only."
