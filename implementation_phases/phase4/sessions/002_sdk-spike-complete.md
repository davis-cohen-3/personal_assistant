# Session: SDK Spike — Complete

**Date:** 2026-03-21
**Phase:** 4 — SDK Spike

## Summary

Completed the SDK spike that was left partially finished in session 001. Upgraded the SDK from 0.1.77 to 0.2.81 (the version had jumped from 0.1.x to 0.2.x — many session and MCP fixes in between). Ran all four phases of the spike script successfully (exit 0). Confirmed all open questions from session 001, discovered and resolved two new issues, and wrote the phase completion report.

## Confirmed Findings

### CLARITY-002 — Model string ✅ RESOLVED
`"claude-opus-4-6"` is the correct string. Claude 4.x models use undated IDs. `supportedModels()` on 0.2.81 returns: `default`, `sonnet[1m]`, `opus[1m]`, `haiku`. Full string works directly in `options.model`.

### IMP-017 — Bad session ID behavior ✅ RESOLVED
On 0.2.81, passing an invalid session ID to `resume` throws immediately with a clear UUID format error. No hang. Simple try/catch + retry without `resume` is sufficient.

### Phase C — Resume with MCP tool call ✅ RESOLVED
Works correctly after the `makeToolsServer()` factory fix from session 001. Same `session_id` maintained across turns. Echo tool called successfully mid-resume.

## Key Decisions / Discoveries

- **IMP-018 — SDK upgrade:** 0.1.77 → 0.2.81. The version had jumped from 0.1.x to 0.2.x with no 0.1.77 in the release history. Upgrade resolves multiple session/MCP bugs. `package.json` now specifies `^0.2.81`.
- **IMP-019 — MCP server instance rule confirmed:** `createSdkMcpServer()` instances can't be reused across `query()` calls. The `makeToolsServer()` factory pattern (from session 001's fix) is the correct production pattern. Tool definitions array can be module-level; only the server wrapper needs re-instantiation per call.
- **Peer dep warning:** SDK 0.2.81 requires `zod@^4.0.0` but project uses `zod@3.x`. The warning does not prevent the SDK from functioning — spike ran cleanly. Zod upgrade deferred until needed.
- **Phase C hang (0.1.77):** Was the "Already connected to a transport" error silently deadlocking, not a stream timeout or backpressure issue as originally theorized.

## Code Changes

- Modified: `scripts/sdk_spike.ts` — added `makeToolsServer()` factory, removed `mcpServers` from `BASE_OPTIONS`, added per-call `mcpServers: { "spike-tools": makeToolsServer() }` at each query site
- Modified: `package.json` — upgraded `@anthropic-ai/claude-agent-sdk` to `^0.2.81`
- Modified: `project_scoping/design/issues_to_be_aware_of.md` — resolved HIGH-10, CLARITY-010, CLARITY-002; updated IMP-017 with real behavior; added IMP-018 and IMP-019
- Modified: `project_scoping/design/02_agent_spec.md` — updated streaming example, session lifecycle table, added MCP server pattern section
- Created: `implementation_phases/phase4/completion_report.md`

## Open Questions

None — all Phase 4 goals are answered.

## Next Steps

- [ ] Phase 5 (whatever that is — check `project/implementation_plan.md`)
- [ ] Zod v4 upgrade before Phase 8 if the peer dep warning becomes a type error
