# Phase 4 Completion Report — Agent SDK Spike

**Status:** Complete
**Output:** Throwaway verification script (`scripts/sdk_spike.ts`) — not production code
**SDK version after phase:** `@anthropic-ai/claude-agent-sdk@0.2.81` (upgraded from 0.1.77)

---

## What Was Verified

Phase 4 was a throwaway spike to answer open questions before wiring the production WebSocket handler in Phase 8. All four phases of the spike script exit cleanly (exit 0).

### HIGH-10 — Token-by-token streaming ✅

Set `includePartialMessages: true` in options. The SDK emits `type: 'stream_event'` messages wrapping `RawMessageStreamEvent`. Text tokens arrive as:

```typescript
msg.type === 'stream_event'
&& msg.event.type === 'content_block_delta'
&& msg.event.delta.type === 'text_delta'
```

Also observed: `thinking_delta` and `signature_delta` (extended thinking blocks) arrive the same way. Without `includePartialMessages`, you get one complete `AssistantMessage` per turn.

### CLARITY-010 — `session_id` location ✅

`session_id` is present on every `SDKMessage` type. First appears on `type: 'system', subtype: 'init'` — the first message emitted. Safe to capture from there and persist to Postgres immediately.

### CLARITY-002 — Model string format ✅

`"claude-opus-4-6"` is the correct string. Claude 4.x models use undated IDs — no snapshot suffix. `supportedModels()` on 0.2.81 returns four entries: `default`, `sonnet[1m]`, `opus[1m]`, `haiku`. Passing the full string directly to `options.model` works.

### IMP-017 — Bad session ID behavior ✅

On SDK 0.2.81, passing a syntactically invalid session ID to `resume` throws immediately with a descriptive error:

```
Error: --resume requires a valid session ID when used with --print.
Session IDs must be in UUID format. Provided value "..." is not a valid UUID.
```

No hang. Simple try/catch + retry without `resume` is sufficient — no timeout needed.

---

## Issues Discovered and Resolved

### IMP-018 — SDK upgrade: 0.1.77 → 0.2.81

The installed version (0.1.77) predated most session resume and in-process MCP stability fixes. Upgraded to 0.2.81 before re-running the spike. Notable fixes in the gap: session close breaking resumeSession, in-process MCP servers disconnecting on config refresh, parallel tool results being dropped.

### IMP-019 — `createSdkMcpServer()` instances cannot be shared across `query()` calls

**This is the most important production finding from Phase 4.**

Each `query()` call connects a new transport to the MCP server instance. Reusing the same instance fails on the second call: `Error: Already connected to a transport`. In 0.1.77 this deadlocked silently (the Phase C hang); in 0.2.81 it throws immediately.

**Required pattern for Phase 8:** create a fresh server instance per `query()` call. The tool definitions array can be a module-level constant — only the wrapper needs re-instantiation:

```typescript
const TOOLS = [syncEmailTool, actionEmailTool, calendarTool, driveTool, bucketsTool];

function makeMcpServer() {
  return createSdkMcpServer({ name: "assistant-tools", version: "1.0.0", tools: TOOLS });
}

// Per user message in handleWebSocket():
for await (const msg of query({
  prompt: userMessage,
  options: { ...agentOptions, mcpServers: { "assistant-tools": makeMcpServer() } },
})) { ... }
```

Conversation continuity is unaffected — it comes from `resume: sessionId` + the `.jsonl` file on disk, which are independent of the server instance.

---

## Issues Addressed

| Issue | Resolution |
|---|---|
| HIGH-10: Streaming may not be token-by-token | Confirmed working — `includePartialMessages: true` + `stream_event` handling |
| CLARITY-010: Which message type carries `session_id` | Every type; first on `system/init` |
| CLARITY-002: Model ID format | `"claude-opus-4-6"` confirmed correct |
| IMP-017: Resume with nonexistent session ID | Throws immediately on 0.2.81; try/catch handles it |
| IMP-018: SDK version | Upgraded to 0.2.81 |
| IMP-019: MCP server instance reuse | Fresh instance per `query()` call — pattern documented in `02_agent_spec.md` |
