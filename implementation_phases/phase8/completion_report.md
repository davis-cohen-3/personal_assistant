# Phase 8 Completion Report: Agent + WebSocket Layer

**Completed:** 2026-03-21
**Status:** Complete — all tests green, all linters clean

## What Was Built

Two tasks wired the Claude Agent SDK into the Hono backend as a streaming WebSocket interface.

### Task 8.1 — `src/server/agent.ts` (21 tests)

Core agent module with three exports:

**`initAgent()`** — Called at server startup. Reads `.claude/skills/` (two levels deep) and appends skill file contents to `SYSTEM_PROMPT`. Handles missing directory gracefully (ENOENT → no-op). Other filesystem errors are re-thrown.

**`streamQuery(ws, conversationId, prompt, sessionId?)`** — Runs a query against the Claude Agent SDK and streams the result over WebSocket:
- Creates a fresh `createCustomMcpServer()` per call (IMP-019)
- Passes `{ prompt, options: { ...BASE_OPTIONS, mcpServers, resume? } }` to `query()`
- Emits `{ type: 'text_delta', content }` for each `content_block_delta` stream event
- On result message, persists session ID via `updateConversation` and assistant message via `createChatMessage`
- Sends `{ type: 'text_done', content }` after completion
- If a `sessionId` is provided and the query throws immediately, retries without `resume` (IMP-017)

**`handleWebSocket(c)`** — Hono WSEvents factory passed to `upgradeWebSocket()`:
- `onOpen`: validates `conversationId` query param and that the conversation exists in DB; sends error + closes on failure
- `onMessage`: validates message with Zod (`{ type: 'chat', content: string.min(1) }`), re-fetches conversation, persists user message, auto-titles on first user message (sliced to 80 chars), then calls `streamQuery`
- `onClose`: no-op (session preserved on disk for future resume)

Key constants:
- `SYSTEM_PROMPT` — base prompt text + appended skills; read dynamically at query time
- `BASE_OPTIONS` — model, permissionMode, allowedTools, agents (email-classifier, meeting-prepper, researcher), persistSession, includePartialMessages
- `AGENT_DEFINITIONS` — three subagent definitions using `claude-haiku-4-5-20251001`

### Task 8.2 — `src/server/index.ts` (updated)

Added to the existing server:
- `createNodeWebSocket({ app })` → `{ injectWebSocket, upgradeWebSocket }` from `@hono/node-server/ws`
- CSP headers middleware (`default-src 'self'; script-src/style-src 'unsafe-inline'; connect-src ws: wss:`)
- `/assets/*` static serving from `./dist/client` (no auth required)
- Origin validation middleware (`hostname` comparison only, port-agnostic for Vite dev proxy compatibility)
- `/ws` route: origin guard → `authMiddleware` → `upgradeWebSocket(handleWebSocket)`
- SPA catch-all `app.get('*', serveStatic({ path: './dist/client/index.html' }))` registered last
- `injectWebSocket(server)` after `serve()`
- `initAgent()` called at startup (non-blocking `.catch()`, same pattern as `loadTokens()`)

### Scripts

- `scripts/dev.sh` — runs Drizzle migrations then starts backend + frontend concurrently with `tsx watch` + `vite`
- `scripts/migrate.sh` — runs Drizzle migrations only
- Both are `chmod +x`

## Implementation Notes

| Finding | Detail |
|---------|--------|
| `query()` API shape | `query({ prompt, options: {...} })` with nested `options` — confirmed from sdk_spike.ts |
| `console.warn` banned | Hook bans `log\|warn\|info\|debug`; used `console.error` for stale-session retry log |
| `Dirent[]` typing | `Awaited<ReturnType<typeof readdir>>` resolves to overload union; explicit `Dirent[]` import fixes `.isFile()` / `.isDirectory()` narrowing |
| Origin validation | Hostname-only comparison (no port) keeps Vite dev proxy working |
| SPA catch-all ordering | Registered as route handler (`app.get`) last, not middleware, to avoid intercepting `/api` and `/ws` |

## Test Results

```
Test Files  12 passed (12)
     Tests  207 passed (207)
```

21 new tests added this phase (agent.test.ts).

## Files Changed

| File | Status |
|------|--------|
| `src/server/agent.ts` | Created |
| `src/server/index.ts` | Updated (WebSocket, CSP, static serving, origin guard) |
| `scripts/dev.sh` | Created |
| `scripts/migrate.sh` | Created |
| `tests/unit/agent.test.ts` | Created |
