# Session: WebSocket Lifecycle Fixes

**Date:** 2026-03-22
**Phase:** 9 — Frontend App Shell + Chat UI + Agent Fixes

## Summary

Fixed critical WebSocket lifecycle bugs that prevented users from sending follow-up messages after agent responses. Investigated the root cause by reading the `@hono/node-ws` v1.1.0 source — the library does NOT close sockets after `onMessage` returns (contrary to the phase 10 spec's hypothesis). The actual issues were client-side: a fragile reconnection counter, `onclose` resetting `loading` prematurely, silent `send()` failures, and an async race condition where old socket `onclose` clobbered new socket references during conversation switches. Also fixed a pre-existing TypeScript build error in `src/server/index.ts`.

## Key Decisions

- **No server-side ping/pong (yet)**: Investigated `@hono/node-ws` source and confirmed it doesn't close sockets. The 1005 closes are real but root cause is still unclear — could be Node.js server timeouts or infrastructure. Client-side fixes make the UX recoverable regardless.
- **`activeConversationIdRef` over generation counter**: User pointed out that a monotonic counter doesn't model conversations correctly (switching back to a prior chat). Using conversation ID as the staleness check is simpler and semantically correct.
- **`loading` only cleared by `text_done`/`error`**: Not by `onclose`. This prevents users from sending messages while the agent is still working. The Reconnect button is the escape hatch.
- **Server-side `processing` flag as safety net**: Rejects messages on the same socket while `streamQuery` is running, in case client guard fails.
- **Socket identity check in `onclose`**: `if (wsRef.current === socket)` prevents async `onclose` from old sockets clobbering new socket references — the critical race condition fix.

## Code Changes

- Modified: `src/client/components/Chat.tsx` — Rewrote WebSocket lifecycle (removed `MAX_CLEAN_RECONNECTS`/`cleanCloseCountRef`, added `activeConversationIdRef`, socket identity check in `onclose`, `readyState` check in `send()`)
- Modified: `src/server/agent.ts` — Added `processing` flag in `handleWebSocket`, diagnostic log after `text_done`
- Modified: `src/server/index.ts` — Fixed `closeAllConnections` TS error by casting `serve()` return to `http.Server`
- Modified: `tests/unit/agent.test.ts` — Fixed incorrect test that expected `onOpen` to do DB lookup (it only checks query params)

## Open Questions

- Root cause of 1005 WebSocket closes still unknown — socket drops after agent response, user sees "Connection lost" banner and clicks Reconnect. Functional but not ideal.
- May need server-side keepalive if the drops are caused by idle timeouts in production (Railway proxy, etc.)

## Next Steps

- [ ] Task 2: Thinking indicator + tool status (UX-1, UX-2)
- [ ] Task 3: Markdown rendering (UX-3)
- [ ] Task 4: Remove Start Day button (UX-4)
- [ ] Task 5: Email reply feedback (BUG-3)
- [ ] Task 6: Archive → Trash (BUG-4)
- [ ] Task 7: Layout redesign
