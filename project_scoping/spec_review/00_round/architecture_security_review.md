# Architecture & Security Review

Issues found during review of `project/design/` docs (01–10 + decisions_log). Organized by severity.

---

## Security Issues

### 1. OAuth tokens stored in plaintext in Postgres — HIGH ✅ ACCEPTED

**Location:** `03_data_layer.md` — `google_tokens` table; `04_backend.md` — `persistTokens()`

`google_tokens` stores `access_token` and `refresh_token` as plain `text` columns. If the database is compromised (SQL injection, backup leak, GCP Cloud Console access by a third party), an attacker gets full Google API access to Gmail, Calendar, and Drive.

**Fix:** AES-256-GCM envelope encryption using Node's built-in `crypto` module. Encrypt before insert, decrypt on read. No extra dependency. Add `ENCRYPTION_KEY` to `.env.example` and GCP Cloud Run env vars.

**Decision:** Implement for v1. Use Node built-in `crypto` (no extra dep).

**Files to change:**
- `src/server/google/auth.ts` — encrypt/decrypt on persist/load
- `src/server/db/schema.ts` — no schema change needed (still `text` columns, just encrypted)
- `.env.example` — add `ENCRYPTION_KEY`

---

### 2. No CSRF protection on state-changing REST endpoints — HIGH ✅ ACCEPTED

**Location:** `04_backend.md` — REST routes; `04_backend.md` — auth middleware

The session is a cookie with `sameSite: 'Strict'`, which helps but can be bypassed in some scenarios (e.g., top-level navigations). POST endpoints like `/api/gmail/send`, `/api/gmail/threads/:id/reply`, and calendar CRUD have no CSRF token.

**Fix:** Bearer token for REST, cookie for WebSocket. OAuth callback returns a JWT bearer token to the frontend (e.g., in the redirect URL fragment or a JSON response). Frontend stores it in memory and attaches `Authorization: Bearer <token>` to all REST `fetch` calls. WebSocket upgrade continues to use the session cookie (same-origin). This eliminates CSRF entirely for REST since the browser won't auto-attach the header.

**Decision:** Option (b) — bearer token for REST, cookie for WebSocket.

**Files to change:**
- `src/server/auth.ts` — return bearer token on OAuth callback, add bearer auth middleware for `/api/*`
- `src/client/` — store token in memory, attach to all `fetch` calls via a shared fetch wrapper
- `src/shared/types.ts` — auth response type

---

### 3. Approval enforcement is prompt-only — no tool-layer gate — MEDIUM ⏭️ DEFERRED TO v2

**Location:** `04_backend.md` — `action_email` and `calendar` tool handlers; decisions_log.md — "Approval enforcement is prompt-only in v1"

The system prompt tells the agent to wait for approval before executing write actions, but there is no code that prevents `action_email.send` or `calendar.create` from executing without prior approval. A prompt injection in an email body could theoretically convince the agent to skip the approval step.

**Decision:** Accept the risk for v1. Single-user app, worst case is an unwanted email/event (reversible). Add tool-layer gate in v2.

---

### 4. WebSocket `conversationId` not validated against authenticated user — MEDIUM ⏭️ DEFERRED TO v2

**Location:** `04_backend.md` — `handleWebSocket()`

Auth middleware validates the session cookie, but `handleWebSocket` takes `conversationId` from the query param and looks it up without ownership check. No `user_id` columns exist.

**Decision:** Skip for v1 (single-user). Would need `user_id` on conversations + ownership validation if multi-tenant is added in v2.

---

### 5. No startup validation of required env vars — LOW ✅ ACCEPTED

**Location:** `04_backend.md` — `JWT_SECRET` accessed with `!` non-null assertion; `06_tech_stack.md` — `.env.example`

If `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `DATABASE_URL` are missing, the app starts but fails unpredictably at runtime.

**Fix:** Validate all required env vars at startup in `src/server/index.ts` and fail fast with clear error messages.

**Decision:** Implement for v1.

**Files to change:**
- `src/server/index.ts` — add env validation before anything else

---

### 6. `/auth/status` leaks email address — LOW ❌ NOT AN ISSUE

**Location:** `04_backend.md` — `/auth/status` route

Returns `{ authenticated: true, email: payload.email }`. Intentional — frontend uses the email for a profile indicator in the UI.

---

### 7. Session cookie `secure: true` breaks local dev — LOW ✅ ACCEPTED

**Location:** `04_backend.md` — OAuth callback `setCookie`

The cookie is set with `secure: true`, which prevents it from being sent over `http://localhost` during local development.

**Fix:** `secure: process.env.NODE_ENV === 'production'`

**Decision:** Implement for v1.

**Files to change:**
- `src/server/auth.ts` — conditional `secure` flag

---

## Architecture Issues

### 8. `syncInbox` fetches threads sequentially — MEDIUM (performance) ✅ ACCEPTED

**Location:** `04_backend.md` — `email.ts` `syncInbox()` function

The `for...of` loop calls `await gmail.getThread()` for each new/changed thread sequentially. If 20 threads are new, that's 20 sequential API calls (~2-4 seconds each = 40-80 seconds).

**Fix:** `Promise.all` with `p-limit` (concurrency of 5).

**Decision:** Implement for v1. Use `p-limit` dependency.

**Files to change:**
- `src/server/email.ts` — parallelize fetch loop
- `package.json` — add `p-limit`

---

### 9. No WebSocket message validation — LOW ✅ ACCEPTED

**Location:** `04_backend.md` — `handleWebSocket()` `ws.on('message', ...)`

`JSON.parse(data)` is called without a try-catch, and `message.type` is accessed without validation. A malformed message crashes the handler.

**Fix:** Zod schema for incoming WS messages + try-catch around `JSON.parse`.

**Decision:** Implement for v1.

**Files to change:**
- `src/server/agent.ts` — add message parsing/validation

---

### 10. Snippet comparison is a weak change-detection heuristic — LOW ⏭️ DEFERRED TO v2

**Location:** `04_backend.md` — `email.ts` `syncInbox()` diff logic

Worst case is a few extra API calls per sync. History ID-based incremental sync already planned for v2.

**Decision:** Skip for v1.

---

### 11. No graceful shutdown — LOW ✅ ACCEPTED

**Location:** `04_backend.md` — server setup in `index.ts`

The Hono server doesn't handle `SIGTERM`. On Cloud Run redeploy, active WebSocket connections and in-flight agent responses get killed abruptly.

**Fix:** `SIGTERM` handler that closes the server and force-exits after 10s.

**Decision:** Implement for v1.

**Files to change:**
- `src/server/index.ts`

---

### 12. Health check has no query timeout — LOW ⏭️ SKIPPED

**Decision:** Skip for v1. Cloud Run's own probe timeout is sufficient.

---

### 13. No rate limiting on REST endpoints — LOW ⏭️ SKIPPED

**Decision:** Skip for v1. Single-user behind allowlist.

---

## Priority Summary

| # | Issue | Severity | Decision |
|---|---|---|---|
| 1 | Token encryption at rest | High | ✅ v1 — Node `crypto` AES-256-GCM |
| 2 | CSRF protection | High | ✅ v1 — Bearer token for REST, cookie for WS |
| 5 | Env var validation at startup | Low | ✅ v1 — trivial |
| 7 | `secure` cookie in local dev | Low | ✅ v1 — trivial |
| 8 | Parallel thread fetching | Medium | ✅ v1 — `p-limit` |
| 9 | WebSocket message validation | Low | ✅ v1 — Zod schema |
| 11 | Graceful shutdown | Low | ✅ v1 — SIGTERM handler |
| 3 | Tool-layer approval gate | Medium | ⏭️ v2 — accept prompt-only risk |
| 4 | ConversationId ownership check | Medium | ⏭️ v2 — single-user, no user_id |
| 10 | Snippet change detection | Low | ⏭️ v2 — history ID sync |
| 6 | Email in `/auth/status` | Low | ❌ Not an issue — used for profile indicator |
| 12 | Health check timeout | Low | ⏭️ Skipped |
| 13 | Rate limiting | Low | ⏭️ Skipped |
