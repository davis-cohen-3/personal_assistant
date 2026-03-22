# Session: Smoke Test & WebSocket Fix

**Date:** 2026-03-21
**Phase:** 9 — Frontend App Shell & Integration

## Summary

Smoke tested the full app in the browser. Identified and fixed the critical WebSocket connection drop issue — root cause was a known `@hono/node-ws` bug where an async `onOpen` handler prevents event handlers from being registered before the upgrade completes. Also fixed several unhandled promise rejections in frontend components and improved agent error handling on the server.

## Key Decisions

- **Async `onOpen` was the WS root cause:** Known bug [honojs/middleware#954](https://github.com/honojs/middleware/issues/954). The `upgradeWebSocket` callback must return the events object synchronously. Moved the async `getConversation()` check out of `onOpen` (it was already duplicated in `onMessage`).
- **Immediate reconnect on clean close:** Changed Chat.tsx to reconnect immediately (not with 1s backoff) on clean WS close, with a `MAX_CLEAN_RECONNECTS` (3) guard to prevent infinite loops.
- **Agent SDK error results now surface to client:** Previously a non-success SDK result left `fullText` empty and sent a blank `text_done` message. Now sends an error message and skips saving empty assistant messages.
- **Considered dropping WebSocket for v1** but the sync `onOpen` fix resolved the issue, so keeping WS streaming for now.

## Code Changes

- Modified: `src/server/agent.ts` — sync `onOpen`, WS close logging, agent error result handling, skip empty assistant messages
- Modified: `src/client/components/Chat.tsx` — immediate reconnect on clean close, `MAX_CLEAN_RECONNECTS` guard, `cleanCloseCountRef`
- Modified: `src/client/components/EventDetail.tsx` — try/catch on `handleSave` and `handleDelete`
- Modified: `src/client/components/ThreadDetail.tsx` — try/catch on `handleArchive`

## Verification

- Build: clean (vite + tsc)
- Tests: 207/207 passing
- Health/auth/SPA endpoints: all responding correctly
- Tailwind CSS: 17KB of utilities generated, classes working
- First message ("Start my day"): agent responded with streaming text, WS stayed open

## Open Questions

- Does multi-turn chat work? (send second message without reloading)
- The WS may still close cleanly after agent response (separate from the async onOpen bug) — need to verify the reconnect logic handles this

## Next Steps

- [ ] Verify multi-turn chat (second message without reload)
- [ ] Test thread detail modal (click email in BucketBoard)
- [ ] Test calendar event detail modal
- [ ] Test reconnect banner (kill/restart backend)
- [ ] Visual CSS/layout check
- [ ] Consider whether to drop WS for v1 if further issues arise
