# Agent Spec

> For full SDK API reference (method signatures, message types, options): see `project/research/agent_sdk_reference.md`

## Agent SDK Setup

The agent uses `@anthropic-ai/claude-agent-sdk` configured in `src/server/agent.ts`. Tools are defined using the SDK's `tool()` helper with Zod schemas, registered on an in-process MCP server via `createSdkMcpServer()`. The agent exposes 5 tools plus 3 subagents:

- **Email tools** — `sync_email` (read/sync), `action_email` (send/reply/draft/archive/mark_read) — all email reads go through local cache, all writes go through Gmail API
- **Google connectors** — `calendar`, `drive` — thin wrappers around the official `googleapis` package (see `07_google_connectors.md`)
- **Data tools** — `buckets` (CRUD on bucket definitions + assign threads to buckets, 1-25 per call) — backed by Postgres via Drizzle ORM

### SDK Initialization

The agent is invoked via `query()` which returns an async generator streaming `SDKMessage` events. For multi-turn WebSocket chat, each user message is a separate `query()` call with `resume: sessionId` to restore prior context.

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// 1. Define tools with Zod schemas, register on in-process MCP server
const toolsServer = createSdkMcpServer({
  name: "assistant-tools",
  version: "1.0.0",
  tools: [/* tool() definitions — see MCP Tools section */]
});

// 2. Configure agent options
const agentOptions = {
  systemPrompt: SYSTEM_PROMPT,
  model: "claude-opus-4-6",
  permissionMode: "bypassPermissions" as const,  // Our tools are in-process; approval is prompt-enforced
  mcpServers: { "assistant-tools": toolsServer },
  allowedTools: [
    "mcp__assistant-tools__sync_email",
    "mcp__assistant-tools__action_email",
    "mcp__assistant-tools__calendar",
    "mcp__assistant-tools__drive",
    "mcp__assistant-tools__buckets",
    "Agent"  // Required to spawn subagents
  ],
  agents: { /* subagent definitions — see Subagents section */ }
};

// 3. Stream token-by-token to WebSocket (set includePartialMessages: true)
// msg.type === 'stream_event' wraps RawMessageStreamEvent from the Anthropic API
// Text tokens arrive as: msg.event.type === 'content_block_delta' + msg.event.delta.type === 'text_delta'
// session_id is on every SDKMessage — capture from the first message (type=system, subtype=init)
for await (const msg of query({ prompt: userMessage, options: { ...agentOptions, includePartialMessages: true } })) {
  if (msg.type === "system" && msg.subtype === "init") {
    capturedSessionId = msg.session_id;
  } else if (msg.type === "stream_event" && msg.event.type === "content_block_delta" && msg.event.delta.type === "text_delta") {
    ws.send(JSON.stringify({ type: "token", delta: msg.event.delta.text }));
  } else if (msg.type === "result") {
    ws.send(JSON.stringify({ type: "done" }));
  }
}

// 3. Resume existing session (multi-turn)
for await (const msg of query({ prompt: nextMessage, options: { ...agentOptions, resume: savedSessionId } })) {
  // same streaming logic
}
```

### In-Process MCP Server: Fresh Instance Per Call (IMP-019 — resolved)

**`createSdkMcpServer()` instances cannot be reused across `query()` calls.** Each call connects a new transport; reusing the instance throws `Already connected to a transport`. In 0.1.77 this silently hung; in 0.2.81 it throws immediately.

**Required pattern:** create a fresh server instance inside each `query()` invocation:

```typescript
function makeMcpServer() {
  return createSdkMcpServer({ name: "assistant-tools", version: "1.0.0", tools });
}
// Per WebSocket message:
for await (const msg of query({ prompt, options: { ...opts, mcpServers: { "assistant-tools": makeMcpServer() } } })) { ... }
```

The tool definitions array (`tools`) can be a module-level constant — only the server wrapper needs to be re-created each call.

### MCP Tool Naming Convention

Tools are referenced as `mcp__{serverName}__{toolName}`:
- `sync_email` in server `assistant-tools` → `mcp__assistant-tools__sync_email`

---

## Session Persistence and Compaction

### SDK Session Storage

The Agent SDK stores sessions as `.jsonl` files on disk (`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`), where `<encoded-cwd>` replaces non-alphanumeric chars with `-`. Each conversation maps to one SDK session via `conversations.sdk_session_id` in Postgres.

- **Resume**: When a WebSocket connects for an existing conversation, the backend passes `resume: sessionId` in `query()` options to restore the SDK session with its full context
- **Fresh start**: If the session file is missing (Cloud Run redeploy, scale-to-zero), `query()` is called without `resume` to start a fresh SDK session. The conversation's `sdk_session_id` is updated in Postgres. Past messages remain visible in the UI from Postgres, but the agent has no memory of prior context. **IMPORTANT:** If the session file is missing, do NOT pass the stale ID to `resume` — the SDK throws immediately with a UUID validation error (IMP-017). Wrap the `query()` call in try/catch and retry without `resume` on error.
- **In-memory option**: Pass `persistSession: false` to skip disk writes (not used in production, but useful for testing)

### Auto-Compaction

The SDK automatically compacts when context approaches the model's limit (1M tokens for Opus/Sonnet 4.6):
- Older messages are summarized internally, reducing token count
- This is transparent to the backend — Postgres `chat_messages` retains the full uncompacted history
- The system prompt includes instructions for what the compactor should preserve

### Compaction Instructions

Added to the system prompt so the SDK's compactor knows what to keep:

```
When compacting conversation history, always preserve:
- The user's current task or request
- Any pending actions awaiting approval
- Names and context of participants discussed in recent messages
- Active bucket assignments mentioned recently
```

### Session Lifecycle

| Event | Behavior |
|---|---|
| New conversation created | `query({ prompt, options })` → fresh `.jsonl` file, `session_id` from result saved to Postgres |
| WebSocket connects to existing conversation | `query({ prompt, options: { ...opts, resume: sessionId } })`. If session ID is invalid/missing, SDK throws immediately — catch and retry without `resume` |
| WebSocket disconnects | No cleanup needed — session file preserved on disk for future resume |
| New user message on existing session | `query({ prompt: nextMessage, options: { ...opts, resume: sessionId } })` |
| Cloud Run redeploy / scale-to-zero | SDK session files lost. Next connection starts fresh session |
| SDK auto-compacts | Internal to SDK. Postgres messages unaffected |

---

## System Prompt Design

The system prompt in `agent.ts` defines:

- **Identity**: Personal assistant for managing email, calendar, and drive
- **Capabilities**: What the agent can do (read/send email, manage calendar, organize inbox into buckets)
- **Approval pattern**: For side-effect operations (sending email, creating events), describe the proposed action in text and wait for the user to confirm in chat before executing
- **No dynamic UI rendering**: The agent writes data via tools (bucket assignments). The frontend renders the current state from the database/API. The agent does not return structured UI components.
- **Personality**: Concise, proactive, executive-assistant tone

```typescript
// src/server/agent.ts
const SYSTEM_PROMPT = `You are a personal assistant that helps manage email, calendar, and drive.

## Tools
You have access to email tools (sync_email for reading, action_email for sending/replying/drafting),
Google tools (calendar, drive), and data tools (buckets for managing and assigning).

## How You Work
You use tools to read and write data. The frontend automatically reflects changes
you make — you do not need to render UI components. Just describe what you did or
what you found in plain text.

## Subagents
You can spawn subagents for parallel work. Use them when:
- Classifying a large number of threads (>25) — spawn email_classifier
- Prepping multiple meetings — spawn meeting_prepper
- Broad cross-service research — spawn researcher
Subagents handle read-only work and return summaries. Only YOU execute write
operations (sending email, creating events) after user approval.
Don't spawn subagents for small tasks you can handle inline.

## Approval Pattern
NEVER execute side-effect operations directly. Always:
1. Describe what you plan to do in your response text
2. Wait for the user to confirm in chat (e.g., "go ahead", "yes", "send it")
3. Only then execute the operation

`;
```

---

## Skills

Skills are workflow definitions stored in `.claude/skills/`. They provide reusable instructions the agent can follow for common workflows. Skill file contents are appended to the `SYSTEM_PROMPT` string in `agent.ts` at server startup. The agent receives them as part of its system instructions, not as separate tool calls or runtime file reads. These are intentionally simple for v1 — we'll iterate on them once we begin testing the agent against real data.

### Morning Briefing (triggered by "Start Day" button)
```
.claude/skills/morning_briefing.md
```
The main agent fans out to subagents for parallel execution, then synthesizes:

1. Spawn `email_classifier` subagent — syncs inbox and classifies all threads into buckets
2. Spawn `meeting_prepper` subagent — reads today's calendar, preps each meeting with related emails/docs
3. Both run concurrently. Main agent waits for results.
4. Synthesize into a daily briefing: priority emails, today's schedule with prep notes, action items

### Inbox Review
```
.claude/skills/inbox_review.md
```
The agent processes inbox in enforced batches of 25. Never classifies all threads at once.

1. Call `sync_email` with action "sync" to refresh the local email cache (diffs against Gmail, only fetches new/changed threads)
2. The response includes stats: `{ new: N, updated: N }`
3. Regardless of sync stats (even if `{ new: 0 }`), always call `sync_email` with action "get_unbucketed" — threads from previous syncs may still be unbucketed
4. If unbucketed > 0:
   a. Read bucket definitions via `buckets list`
   b. For each unbucketed thread in the batch, decide which bucket it belongs in
      based on thread subject, snippet, sender, and body content from cached data
   c. Call `buckets assign` with assignments (max 25 per call)
   d. The response tells how many unbucketed threads remain
   e. If remaining > 0, call `sync_email` with action "get_unbucketed" to get the next batch
   f. Repeat until remaining = 0
5. Summarize: how many threads were sorted, into which buckets, and what needs attention
6. If any thread needs a reply, offer to draft one via `action_email` (approval required before sending)

**Rules:**
- NEVER process more than 25 threads at a time
- Always use `buckets assign` for bulk work
- If a thread could fit multiple buckets, pick the most specific one
- Classification uses locally cached data (email_threads + email_messages) — no extra Gmail API calls

### Re-bucketing (triggered automatically when a new bucket is created)

When `buckets create` returns `rebucket_required: true`:

1. Read all bucket definitions via `buckets list` (including the new one)
2. Fetch threads needing re-evaluation (threads where `needs_rebucket = true`) via `sync_email` get_unbucketed or a dedicated rebucket fetch
3. For each batch of up to 25 threads:
   a. Using cached subject, snippet, and body content, decide if the thread belongs in the new bucket or stays in its current bucket
   b. Call `buckets assign` for any threads that should move (this clears the rebucket flag implicitly for assigned threads)
   c. For threads that stay in their current bucket, `buckets assign` with the same bucket_id clears the flag
4. Repeat until no threads need re-bucketing
5. Report what moved and where

### Draft Reply
```
.claude/skills/draft_reply.md
```
- Read the thread via `sync_email` get_thread action
- Draft a reply in text
- Wait for user approval before sending

### Meeting Prep
```
.claude/skills/meeting_prep.md
```
For a single meeting, the main agent can prep inline. For multiple meetings ("prep me for today"), the main agent spawns one `meeting_prepper` subagent to handle all meetings in parallel.

The prepper (whether main agent or subagent) follows this flow per meeting:
- Read event details via `calendar` tool (attendees, description, location)
- Search for recent threads with attendees via `sync_email` search
- Search for related docs via `drive` tool (keywords from event title/description)
- Compile a briefing: attendee context, related threads, relevant docs, suggested talking points

---

## Subagents

The main agent (Opus) can spawn subagents to parallelize work. Subagents are defined via the `agents` option in the SDK config using `AgentDefinition` objects, and Claude invokes them via the built-in `Agent` tool (which must be in `allowedTools`). The main agent decides when to use them based on each subagent's `description` field — they're tools, not hardcoded workflow steps.

### When to fan out vs. inline

The main agent uses subagents when:
- **Volume justifies it** — 200 threads to classify, 5 meetings to prep. For 10 threads or 1 meeting, just do it inline.
- **Tasks are independent** — bucketing and calendar prep don't depend on each other. Prepping meeting A doesn't depend on meeting B.
- **The user asks for breadth** — "prep me for all my meetings", "review my whole inbox", "find everything related to Project X across email and drive."

### Subagent Definitions

All subagents run on Haiku for cost efficiency. They use the SDK's `AgentDefinition` interface with tool access scoped via the `tools` array (using `mcp__{serverName}__{toolName}` naming). **No subagent has write tool access** — only the main agent can execute side-effect operations (sending email, creating/updating/deleting events). Subagents are read-only workers.

```typescript
// AgentDefinition interface (from SDK)
interface AgentDefinition {
  description: string;   // When to use this agent (Claude reads this to decide)
  prompt: string;        // System prompt for the subagent
  tools?: string[];      // Scoped tool access (inherits all if omitted)
  model?: "sonnet" | "opus" | "haiku" | "inherit";
}
```

#### `email_classifier`

Classifies email threads into buckets. Takes over the batch-of-25 loop that would otherwise run sequentially in the main agent's context.

```typescript
"email-classifier": {
  description: "Classifies email threads into buckets. Use for inbox triage and bulk classification.",
  prompt: "You are an email classification assistant. Sync the inbox, read bucket definitions, then classify all unbucketed threads in batches of 25. For each thread, choose the most specific matching bucket based on subject, sender, snippet, and body content. Return a summary of what was classified and into which buckets.",
  tools: ["mcp__assistant-tools__sync_email", "mcp__assistant-tools__buckets"],
  model: "haiku"
}
```

**Why a subagent?** Bucketing is the most token-intensive workflow — each batch sends thread content + bucket definitions to the model. Running this in the main agent's context pollutes it with hundreds of thread snippets that aren't useful for subsequent conversation. The subagent's context is discarded after classification; only the summary returns.

#### `meeting_prepper`

Researches context for upcoming meetings. Searches email and drive for related materials, compiles a briefing.

```typescript
"meeting-prepper": {
  description: "Researches context for upcoming meetings. Use when prepping multiple meetings.",
  prompt: "You are a meeting prep assistant. For each meeting provided, research context: search for recent email threads involving the attendees, search Drive for documents related to the meeting topic, and check for scheduling conflicts. Return a structured briefing per meeting: attendees with recent interaction context, related documents, key threads, and suggested prep notes.",
  tools: [
    "mcp__assistant-tools__calendar",
    "mcp__assistant-tools__sync_email",
    "mcp__assistant-tools__drive"
  ],
  model: "haiku"
}
```

**Why a subagent?** Meeting prep requires multiple search queries per meeting (email by attendee, drive by topic). For 5 meetings, that's 15+ tool calls and substantial search results. Isolating this keeps the main agent's context focused on synthesis and conversation.

#### `researcher`

General-purpose search agent for ad-hoc cross-service queries.

```typescript
"researcher": {
  description: "General-purpose cross-service search. Use for broad research queries.",
  prompt: "You are a research assistant. Search across email, calendar, and drive to find information relevant to the user's query. Be thorough — check multiple search terms, look at related threads, and cross-reference findings. Return a concise summary of what you found with specific references (thread IDs, file names, event details).",
  tools: [
    "mcp__assistant-tools__sync_email",
    "mcp__assistant-tools__calendar",
    "mcp__assistant-tools__drive"
  ],
  model: "haiku"
}
```

**Why a subagent?** Open-ended research ("find everything about the Acme deal") can require many search iterations. The subagent can explore broadly without ballooning the main agent's context. The main agent gets a focused summary it can present or act on.

### Subagent Constraints

- **No external side-effects.** Subagents cannot send email or create/modify calendar events. Internal data writes (bucket assignment via `buckets assign`) are permitted for the `email_classifier`. All external side-effects (Gmail, Calendar writes) require the main agent + user approval.
- **No nested subagents.** Subagents cannot spawn their own subagents.
- **Context isolation.** Subagents don't see the parent conversation. They receive only their system prompt + the task description from the parent. Only the subagent's final message returns to the parent. Subagents do receive the project's `CLAUDE.md`.
- **Cost awareness.** Each subagent runs its own context window. Spawning 4 classifiers in parallel costs ~4x a single classifier. The main agent should batch intelligently — don't spawn a subagent for 5 threads.

---

## How the Agent Uses MCP Tools

All 5 MCP tools live in a single in-process MCP server created via `createSdkMcpServer()`. Each tool is defined using the SDK's `tool()` helper with Zod schemas for input validation and a handler function. The main agent also has access to the `Agent` tool for spawning subagents (see Subagents section above). See `07_google_connectors.md` for full Google API specs. Email read logic lives in `src/server/email.ts` — tools delegate to it.

### Tool Definition Pattern

All tools follow this pattern — Zod schema for input, handler delegates to connectors/queries:

```typescript
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

tool(
  "tool_name",
  "Description for the agent",
  { /* Zod raw shape (NOT z.object) */ },
  async (args) => {
    const result = await delegateToConnectorOrQuery(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);
```

Handler returns `CallToolResult`: `{ content: [{ type: "text", text: string }] }`.

### Email Tools

| Tool | Usage |
|---|---|
| `sync_email` | All email reads. Four actions: `sync` (bulk inbox refresh, diff-based, returns stats only), `search` (ad-hoc Gmail query, syncs results, returns matched threads), `get_thread` (single thread with full messages), `get_unbucketed` (DB-only, next batch of 25 unbucketed threads for classification). All reads go through `email.ts` → local cache. |
| `action_email` | All email writes. Send, reply, draft, archive, mark read. Every action requires user approval. |

### Google Connectors (in-process, via `googleapis`)

| Tool | Usage |
|---|---|
| `calendar` | Read events, create/update/delete events, check free/busy |
| `drive` | Search files, read Google Docs content, list recent files |

### Data Tools (in-process, Postgres-backed)

| Tool | Usage |
|---|---|
| `buckets` | Manage bucket definitions (list/create/update/delete) and assign threads to buckets (1-25 per call). Creating a bucket triggers re-bucketing. Assign returns assigned count + remaining unbucketed count. |

The agent decides which tools to use based on the user's request and the system prompt's instructions. The same `google/*` connectors are also exposed via REST API (`/api/*`) for direct UI actions that bypass the agent.
