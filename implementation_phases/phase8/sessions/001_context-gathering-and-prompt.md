# Session: Context Gathering and Kickoff Prompt

**Date:** 2026-03-21
**Phase:** 8 — Server + Agent WebSocket

## Summary

This session was dedicated to reading all relevant docs and source files to build a complete picture of what Phase 8 requires. No code was written. The session ended by producing a self-contained kickoff prompt for a fresh chat to implement Phase 8 with TDD.

## Key Decisions

- **handleWebSocket signature**: Use Hono's `(c: Context) => WSEvents` factory pattern (not raw `ws: WebSocket` as shown in `04_backend.md`). Extract `conversationId` from `new URL(c.req.url).searchParams.get('conversationId')` in the factory, not inside `onOpen`.
- **Streaming approach**: Use `includePartialMessages: true` + `stream_event`/`content_block_delta`/`text_delta` for token-by-token streaming per Phase 4 spike findings (HIGH-10). Use `result.result` as authoritative `fullText` for persistence.
- **IMP-019 (MCP server reuse)**: `createCustomMcpServer()` must be called fresh per `query()` call inside `streamQuery`. NOT in `baseOptions`.
- **IMP-017 (stale session)**: Wrap the entire `for await` in try/catch; if it throws and a sessionId was provided, retry without `resume`.
- **Type safety**: `BetaRawMessageStreamEvent` (from `@anthropic-ai/sdk`, not separately installed) resolves to effectively `any` with `skipLibCheck: true`. Accessing `message.event.type`, `.delta.type`, `.delta.text` is valid with no explicit `any` written.
- **skills directory**: Read `.claude/skills/*.md` at startup; handle missing directory gracefully (no throw, just skip).

## Code Changes

None — context-gathering session only.

## Key Files Read

- `project_scoping/implementation_plan.md` (Phase 8 section)
- `project_scoping/design/02_agent_spec.md` (system prompt, subagents, approval flow)
- `project_scoping/design/04_backend.md` (Hono server setup, WebSocket Chat Route)
- `agent_docs/backend-patterns.md`
- `agent_docs/testing.md`
- `implementation_phases/phase4/completion_report.md` (spike findings)
- `src/server/index.ts`, `src/server/tools.ts`, `src/server/auth.ts`
- `src/server/db/queries.ts` (conversation/message query signatures)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (SDK types)
- `node_modules/hono/dist/types/helper/websocket/index.d.ts` (WSContext, WSEvents)
- `node_modules/@hono/node-ws/dist/index.d.ts`
- `tests/unit/tools.test.ts` (vi.hoisted + vi.mock pattern)

## Open Questions

None — all questions resolved via doc reading and type inspection.

## Next Steps

- [ ] Write tests in `tests/unit/agent.test.ts` (TDD, auto mode)
- [ ] Implement `src/server/agent.ts`
- [ ] Expand `src/server/index.ts` (CSP, static files, WebSocket route, injectWebSocket)
- [ ] Create `scripts/dev.sh` and `scripts/migrate.sh`
- [ ] Run `pnpm test` — all 186 existing tests must stay green
