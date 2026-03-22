# Session: Agent.ts, Index.ts, Scripts

**Date:** 2026-03-21
**Phase:** 8 — Agent + WebSocket Layer

## Summary

Implemented the full Phase 8 agent layer using TDD. Created `src/server/agent.ts` with SYSTEM_PROMPT, `initAgent()`, `streamQuery()`, and `handleWebSocket()`. Expanded `src/server/index.ts` to add WebSocket support, CSP headers, static file serving, and origin validation. Created `scripts/dev.sh` and `scripts/migrate.sh`. All 207 tests pass and all linters are clean.

## Key Decisions

- `query()` API is `query({ prompt, options: {...} })` (nested `options` object), not a flat spread — confirmed from `scripts/sdk_spike.ts`.
- `console.warn` is banned by the hook (`check_typescript_quality.py` bans `log|warn|info|debug`); used `console.error` for the stale-session retry log instead.
- `entries: Dirent[]` (importing from `node:fs`) instead of `Awaited<ReturnType<typeof readdir>>` — the latter resolves to the overload union and breaks `.isFile()` / `.isDirectory()` type narrowing.
- Skills loading does two levels deep (top-level .md files + one subdir) rather than true recursive, to match the `.claude/skills/subdir/file.md` structure.
- SPA catch-all registered as `app.get('*', serveStatic(...))` (route handler, last) rather than `app.use('*', ...)` (middleware, would intercept API/WS routes).
- Origin validation compares `hostname` only (ignoring port) so Vite dev proxy at `localhost:5173` still works against backend at `localhost:3000`.
- `initAgent()` called from `index.ts` startup with `.catch()` (non-blocking) — same pattern as `loadTokens()`.

## Code Changes

- Created: `src/server/agent.ts`
- Modified: `src/server/index.ts`
- Created: `scripts/dev.sh` (chmod +x)
- Created: `scripts/migrate.sh` (chmod +x)
- Created: `tests/unit/agent.test.ts` (21 tests)

## Open Questions

- None — phase 8 tasks 8.1 and 8.2 are complete.

## Next Steps

- [ ] Phase 8 remaining: frontend WebSocket client + chat UI components (if in scope)
- [ ] Smoke test the full WebSocket flow end-to-end with a real agent query
- [ ] Verify `injectWebSocket` + `upgradeWebSocket` work correctly against the running server
