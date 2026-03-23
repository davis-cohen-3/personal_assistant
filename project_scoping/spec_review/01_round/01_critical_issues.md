# Critical Issues — Must Resolve Before Implementation

These are the highest-severity findings across all review dimensions. Each blocks or significantly risks implementation correctness.

---

## ~~CRIT-001: WebSocket Conversation Scoping Contradiction~~ RESOLVED

**Related:** CLARITY-009, CLARITY-018, CLARITY-028, LOGIC-001, LOGIC-009, LOGIC-005, ARCH-002

**Resolution:** WebSocket is for agent chat streaming only. No app-level `WebSocketProvider`, no `data_changed` event system.

- **WebSocket:** `/ws?conversationId=xxx` — conversation-scoped, opened only when a conversation is active. Reconnects on conversation switch. Only message types: `chat`, `text_delta`, `text_done`, `error`.
- **Data hooks:** `useBuckets`, `useCalendarEvents`, `useConversations` fetch via REST on mount and after their own mutations. Refetch on window focus (like react-query default).
- **Agent-initiated changes:** When `text_done` arrives on the chat WebSocket, all active data hooks refetch. This is the only cross-path invalidation mechanism. Brief staleness during agent execution is acceptable — the user is watching the agent's streamed text.
- **Kill:** `EventEmitter` singleton (`events.ts`), `emitDataChanged()`, `WebSocketProvider`, `useDataChangedEvent` hook, `data_changed` WebSocket message type, `DataChangedEntity` type.

**Docs to update:** `04_backend.md`, `05_frontend.md`, `decisions_log.md`, `02_agent_spec.md`

---

## CRIT-002: Bearer Token Lost on Page Refresh

**RESOLVED.** Switched to cookie-only auth. Session cookie authenticates all requests (survives refresh). CSRF protection via `X-CSRF-Token` header (HMAC of session cookie, fetched from `GET /auth/status` on every page load). Bearer token eliminated entirely.

**Updated docs:** `04_backend.md`, `05_frontend.md`, `decisions_log.md`

---

## CRIT-003: JWT Exposed in URL After OAuth

**RESOLVED.** OAuth callback now sets the httpOnly session cookie and redirects to `/` with no token in the URL. The JWT is never exposed to JS, URLs, or logs.

**Updated docs:** `04_backend.md`, `05_frontend.md`

---

## ~~CRIT-004: No Technical Enforcement on Agent Write Operations~~ ACCEPTED RISK

**Related:** SEC-002, SEC-007, FEAS-005

Prompt-only enforcement is accepted for v1. Single-user app — worst case is an unwanted email/event, which is reversible. Already documented in the decisions log as a deliberate trade-off.

---

## CRIT-005: Cookie Fallback on REST Negates CSRF Protection

**RESOLVED.** Cookie-only auth with `X-CSRF-Token` header required on all state-changing requests (POST/PUT/PATCH/DELETE). The middleware validates the CSRF token (HMAC of session cookie) before allowing writes. Cross-origin requests cannot forge the header.

**Updated docs:** `04_backend.md`

---

## ~~CRIT-006: Agent SDK API Surface Unverified~~ RESOLVED

**Status:** Resolved

**Resolution:** All SDK API surfaces verified against official documentation and npm package. Research docs created at `project/research/agent_sdk_reference.md` and `project/research/googleapis_reference.md`. Design docs updated:

- `02_agent_spec.md` — SDK initialization (`query()`, V2 session API), `tool()` + Zod schemas, `createSdkMcpServer()`, `AgentDefinition` interface, `allowedTools` with `mcp__` naming, `permissionMode`, session resume/create lifecycle
- `04_backend.md` — Model corrected to `claude-opus-4-6`, added `permissionMode`, `agents`, `"Agent"` in `allowedTools`, fixed `stream_event` to verified `assistant` message type
- `07_google_connectors.md` — Tool schemas converted to `tool()` + Zod, `GaxiosError` import clarified, `p-limit` for concurrency

All 5 originally unverified APIs confirmed:
1. `query({ prompt, options })` as async generator — confirmed
2. `resume: sessionId` — confirmed (V1 and V2 APIs)
3. `SystemMessage` with `session_id` — confirmed
4. `Agent` tool + `AgentDefinition` with `model: "haiku"` — confirmed
5. Session files at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` — confirmed

GCP Cloud Run fallback documented: fall back to `createSession()` when session file missing.

---

## ~~CRIT-007: Conversation Creation Schema Requires Title But Frontend Sends None~~ RESOLVED

**Resolution:** `title` is now optional in `createConversationSchema`. Route defaults to `"New conversation"` when omitted. Auto-title overwrites on first user message (truncated to 80 chars).

**Updated docs:** `04_backend.md`
