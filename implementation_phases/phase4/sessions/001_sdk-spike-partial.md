# Session: SDK Spike — Partial Results

**Date:** 2026-03-21
**Phase:** 4 — SDK Spike

## Summary

Created `scripts/sdk_spike.ts` to verify Agent SDK assumptions. Ran it against the real API and confirmed 3 of 4 target questions. Phase C (resume with valid session) hung after the MCP tool call — root cause identified by a linter that auto-fixed the script: **MCP server instances cannot be reused across `query()` calls**. The script was refactored to use a `makeToolsServer()` factory. Phase D (bad session ID) was never reached. A new chat is needed to re-run the fixed script.

## Confirmed Findings

### CLARITY-010 — session_id location ✅ RESOLVED
`session_id` is present on **every** `SDKMessage` type (system/init, assistant, user, result, stream_event, etc.). First appears on `type=system/init`.

### HIGH-10 — Streaming behavior ✅ RESOLVED
Token-by-token streaming works. Requires `includePartialMessages: true` in options. Token events arrive as `type='stream_event'` (`SDKPartialAssistantMessage`) wrapping `RawMessageStreamEvent`. Text tokens: `event.type === 'content_block_delta'` + `delta.type === 'text_delta'`. Observed event subtypes: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`. Without the flag, you get one full `SDKAssistantMessage` block per turn.

### CLARITY-002 / LOGIC-014 — Model string ⚠️ PARTIAL
Default model shown in `system/init` is `claude-sonnet-4-5-20250929`. `supportedModels()` returns only shorthand aliases: `"default"`, `"opus"`, `"haiku"` — not full model ID strings. Whether `"claude-opus-4-6"` is the correct string for `options.model` is **unconfirmed** and needs re-run.

## Key Decisions / Discoveries

- **MCP server instances can't be reused across `query()` calls.** The original script created one `toolsServer` constant and passed it to multiple `query()` calls — this caused Phase C to hang after the tool returned. The linter auto-fixed this by extracting a `makeToolsServer()` factory function that creates a fresh server instance per call. This is the likely root cause of the hang.
- `permissionMode: 'bypassPermissions'` requires `allowDangerouslySkipPermissions: true` companion flag (not documented in the spec).
- `settingSources: []` disables loading of CLAUDE.md / project settings for SDK queries (useful for clean spike testing).
- `tools: []` in options disables all built-in Claude Code tools (not the same as `allowedTools`).

## Code Changes

- Created: `scripts/sdk_spike.ts` — throwaway spike script (auto-fixed by linter to use `makeToolsServer()` factory)

## Open Questions / Still Needed

- **IMP-017**: What happens when `resume` is set to a nonexistent session ID? Throws? Hangs? Starts fresh? (Phase D never ran)
- **CLARITY-002**: Does `options.model: "claude-opus-4-6"` work, or is a different string required?
- Confirm Phase C actually works with the fixed `makeToolsServer()` factory

## Next Steps

- [ ] Re-run the fixed `scripts/sdk_spike.ts` in a new chat (script already updated by linter)
- [ ] Confirm Phase C completes successfully with fresh server per query
- [ ] Confirm Phase D behavior (bad session ID)
- [ ] Pin the verified Opus 4.6 model string
- [ ] Update `project_scoping/design/issues_to_be_aware_of.md` with all resolved items
- [ ] Update `project_scoping/design/02_agent_spec.md` with streaming approach (`includePartialMessages: true`)
- [ ] Record model string and `makeToolsServer()` finding in `decisions_log.md`
