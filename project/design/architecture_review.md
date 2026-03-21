# Architecture Review: Layer Purity & Agent Design

## Status: Proposed Changes

This document reviews the current design docs and proposes changes to achieve a clean, consistent architecture. The three core issues are: (1) core/ is not actually pure, (2) the agent layer is undesigned, and (3) tools need a clear home and calling convention.

---

## Issue 1: Core Imports Connectors — Breaking Its Own Purity Contract

### What the docs say

> "Core handles data operations only — no LLM calls, no classification, no message drafting."
> — backend_architecture.md

> "core/ imports from db/, connectors/, infra/, and shared/ only."
> — business_logic.md

### What the docs then do

These core functions directly import and call connector singletons:

| Core function | Connector call | What it does |
|---|---|---|
| `threads.fetchNewThreads` | `emailClient.searchThreads` | Fetches threads from Gmail API |
| `events.syncFromCalendar` | `calendarClient.listEvents` | Fetches events from Google Calendar API |
| `events.resolveParticipant` | `calendarClient.getEvent` | Fallback participant lookup via Calendar |
| `actions.approve` (via `executeExternalOperation`) | `emailClient.sendEmail`, `calendarClient.createEvent`, `driveClient.createDocument`, etc. | Dispatches side-effect operations to external APIs |

### Why this is a problem

1. **Core is supposed to be the pure business logic layer.** If it directly calls Gmail/Calendar/Drive, it's not pure — it's an orchestration layer with side effects.
2. **Testing becomes harder.** Core functions that call connectors need connector mocks. Pure core functions only need a DB handle.
3. **Two layers independently hit external APIs** (`core/` and `agents/`), making it unclear who owns the "fetch → process → persist" flow.
4. **The operation dispatch table in `core/actions.ts`** is particularly problematic — it's a 40-line switch statement mapping operations to connector calls. This is integration/orchestration logic, not business logic.

### Proposed fix

**Core never imports connectors.** Core becomes truly pure: DB + validation + state machines + transactions. Nothing else.

Functions that currently call connectors get split:

| Current (in core/) | Proposed |
|---|---|
| `threads.fetchNewThreads` (fetches from Gmail + upserts) | **Remove from core.** The caller (agent tool or heartbeat) calls the connector to fetch, then calls `core/threads.upsertFromGmail` with the results. |
| `events.syncFromCalendar` (fetches from Calendar + upserts) | **Remove from core.** Same pattern — caller fetches, core persists. |
| `events.resolveParticipant` (falls back to Calendar API) | **Remove connector fallback.** Core returns what it has from DB. If the caller needs the Calendar fallback, it handles that. |
| `actions.approve` + `executeExternalOperation` | **Split.** Core marks the action as `approved` and returns it. The caller (agent tool) executes the external operation via the connector, then calls `core/actions.markExecuted` or `core/actions.markFailed`. |

**After this change, core's import rules become:**

| Layer | May import from | Must NOT import from |
|---|---|---|
| `core/` | `db/`, `infra/`, `shared/` | `connectors/`, `agents/`, `routes/`, `drizzle-orm` |

No exceptions. No "except for sync functions." Clean.

---

## Issue 2: The Agent Layer Is Undesigned

### What exists

The docs mention:
- `agents/orchestrator.ts` — referenced but not specified
- `agents/skills/*.ts` — six skills listed by filename, behavior described indirectly through core module docs
- `POST /api/agent/chat` — API endpoint exists
- WebSocket events: `conversation:chunk`, `conversation:complete`, `conversation:action`

### What's missing

1. **No tool definitions.** The agent uses Claude Agent SDK, which requires tools to be defined. What tools does the agent have? What are their schemas? How do they map to core/connector calls?
2. **No orchestrator design.** How is the Claude Agent SDK client initialized? How is conversation state managed? How does multi-turn chat work?
3. **No streaming design.** How do agent responses stream to the frontend? The WebSocket events are listed but the mechanism connecting Agent SDK streaming → WebSocket broadcast is not designed.
4. **No skill specification.** Skills are mentioned (Sort Inbox, Prep Meeting, etc.) but their tool usage, prompt structure, and lifecycle aren't specified.

### Proposed design

See the new `agents_layer.md` document for the full design. Summary:

```
agents/
  client.ts              ← Claude Agent SDK client initialization
  orchestrator.ts        ← Conversation management, tool registration, streaming
  tools/                 ← Tool definitions (bridge between agent and system)
    index.ts             ← Tool registry
    thread-tools.ts      ← fetchInbox, classifyThread, investigateThread
    event-tools.ts       ← syncCalendar, prepMeeting, postMeeting
    task-tools.ts        ← createTask, delegateTask, detectCompletions
    action-tools.ts      ← proposeAction, executeApprovedAction
    people-tools.ts      ← proposePerson, lookupPerson
    briefing-tools.ts    ← generateBriefing
    read-tools.ts        ← readThread, readEvent, readDocument, searchDocuments
  skills/                ← Pre-composed workflows (orchestrate multiple tool calls)
    sort-inbox.ts
    investigate-thread.ts
    prep-meeting.ts
    post-meeting.ts
    daily-briefing.ts
    delegate-task.ts
```

---

## Issue 3: Tools Should Call Core, Not Connectors Directly (Mostly)

### The question

> "Tools should probably call module methods instead of connector methods — what do you think?"

### The answer: Tools are the integration point

Tools need to call **both** core and connectors, but with a clear split:

| Operation type | Tool calls | Example |
|---|---|---|
| **Read external data** | Connector directly | `emailClient.readThread(id)` — reading a Gmail thread for context |
| **Write/mutate business state** | Core module | `core/threads.upsertFromGmail(db, data)` — persisting thread data |
| **Validate + persist** | Core module | `core/tasks.create(db, data, 'agent')` — creating a task with validation |
| **Execute side effects** | Connector (after core approval) | `emailClient.sendEmail(params)` — only after `core/actions.approve` |
| **Fetch + persist combo** | Connector then core | Fetch from Gmail → `core/threads.upsertFromGmail` |

### Why not tools → core → connectors?

If we forced all connector access through core, core would become an orchestration layer again (the problem we're trying to fix). Core's job is business logic. The tool's job is orchestration — composing connector reads with core writes.

### Why not tools → connectors directly for everything?

Because tools would bypass validation, state machines, and transaction boundaries. You'd duplicate business logic in every tool.

### The rule

> **Tools call connectors for external reads. Tools call core for all business logic, validation, persistence, and state transitions. Tools never call db/ directly.**

This gives us:

```
Agent (LLM) → Tool (in agents/tools/) → core/ (business logic + DB)
                                       → connectors/ (external API reads)
```

### Import rules (revised)

| Layer | May import from | Must NOT import from |
|---|---|---|
| `routes/` | `core/`, `agents/orchestrator` (chat endpoint only), `infra/`, `shared/` | `db/`, `drizzle-orm`, `connectors/`, `agents/tools/`, `agents/skills/` |
| `core/` | `db/`, `infra/`, `shared/` | `connectors/`, `agents/`, `routes/`, `drizzle-orm` |
| `db/` | `drizzle-orm`, `infra/`, `db/schema`, `shared/` | Everything else |
| `agents/tools/` | `core/`, `connectors/`, `infra/`, `shared/` | `db/`, `drizzle-orm`, `routes/` |
| `agents/skills/` | `agents/tools/`, `core/`, `infra/`, `shared/` | `db/`, `connectors/`, `routes/` |
| `agents/orchestrator` | `agents/skills/`, `agents/tools/`, `core/`, `infra/`, `shared/` | `db/`, `connectors/`, `routes/` |
| `connectors/` | `infra/`, `shared/` | Everything else |
| `infra/` | `shared/` | Everything else |

**Note on skills vs tools:** Skills orchestrate via tools, never connectors directly. This ensures all external access goes through tool functions which handle the connector→core composition consistently.

---

## Issue 4: Who Manages Agent Chat Lifecycle?

### Current gap

There's no design for how:
1. A user message arrives at `POST /api/agent/chat`
2. The orchestrator processes it (tool calls, multi-turn)
3. Streaming chunks reach the frontend via WebSocket
4. The conversation context persists across requests

### Proposed: `agents/orchestrator.ts` owns conversation, `infra/websocket.ts` owns streaming transport

**Orchestrator responsibilities:**
- Initialize Claude Agent SDK client with tool definitions
- Maintain conversation message history (in-memory for single-user)
- Process incoming user messages → agent responses
- Handle tool call execution (dispatch to tool functions)
- Emit events to WebSocket for streaming

**infra/websocket.ts responsibilities (already partially designed):**
- Manage WebSocket connections
- Provide `broadcast(event, data)` API
- Handle reconnection and keepalive

**The flow:**

```
1. POST /api/agent/chat { message: "..." }
2. routes/agent.ts → agents/orchestrator.chat(message)
3. orchestrator sends message to Claude Agent SDK
4. Agent SDK streams response:
   - Text chunks → orchestrator emits via websocket.broadcast('conversation:chunk', ...)
   - Tool calls → orchestrator executes tool function → returns result to agent
   - Tool calls that create proposals → orchestrator emits via websocket.broadcast('action:proposed', ...)
5. Stream ends → orchestrator emits websocket.broadcast('conversation:complete', ...)
6. Route returns 202 Accepted (response delivered via WebSocket, not HTTP body)
```

### Skills as pre-composed workflows

Skills are not separate agents — they're pre-composed sequences of tool calls with specific prompts. When the user says "sort my inbox" or hits the Start Day button:

1. Route calls `orchestrator.runSkill('sort-inbox')`
2. Orchestrator creates an ephemeral agent (or uses a skill-specific system prompt)
3. The skill's system prompt guides the agent to use the right tools in the right order
4. All tool calls go through the same tool functions, ensuring consistent validation and persistence

---

## Summary of Changes Needed

### Documents to update

1. **backend_architecture.md** — Remove `connectors/` from core's import list. Add `agents/tools/` and `agents/skills/` to directory structure. Update data flow diagrams. Update ESLint rules.

2. **business_logic.md** — Remove `fetchNewThreads` from core/threads.ts. Remove `syncFromCalendar` from core/events.ts. Remove connector fallback from `resolveParticipant`. Split `actions.approve` — core only marks approved, doesn't execute. Remove all `import { emailClient }` / `calendarClient` / `driveClient` references from core examples.

3. **New: agents_layer.md** — Full agent layer design: client setup, orchestrator, tools, skills, conversation management, streaming, heartbeat integration.

### Migration of functions

| Function | From | To |
|---|---|---|
| Fetch Gmail threads | `core/threads.fetchNewThreads` | `agents/tools/thread-tools.ts → fetchInbox()` |
| Sync calendar events | `core/events.syncFromCalendar` | `agents/tools/event-tools.ts → syncCalendar()` |
| Resolve participant (Calendar fallback) | `core/events.resolveParticipant` | `agents/tools/people-tools.ts → resolveParticipant()` |
| Execute external operation (action dispatch) | `core/actions.approve` (internal) | `agents/tools/action-tools.ts → executeApprovedAction()` |

### What stays in core

Everything else. Core remains the authority for:
- Validation rules (duplicate email, invalid transitions, etc.)
- State machines (people status, task status, action status)
- Transaction boundaries (investigation plans, post-meeting plans, bucket removal)
- CRUD operations with business logic
- Domain error hierarchy

Core just stops reaching out to external services. It receives data and processes it. Pure in, pure out.

---

## Heartbeat Revision

The heartbeat currently mixes core and agent calls. With the new design:

```typescript
// Heartbeat pseudo-code (revised)
async function heartbeat(db: DB) {
  // Steps that need external data → use tools (which call connectors + core)
  await tools.fetchInbox(db);                        // connector → core
  await tools.syncCalendar(db, todayRange());         // connector → core

  // Steps that are pure business logic → call core directly
  await tasksCore.flagOverdue(db);                    // pure core
  await actionsCore.expireStale(db, { hours: 24 });   // pure core
  await actionsCore.retryStuckApproved(db);           // pure core

  // Steps that need LLM → use skills (which use tools)
  await skills.classifyNewThreads(db);                // LLM → tools → core
  await skills.processEndedMeetings(db);              // LLM → tools → core
  await skills.detectCompletions(db);                 // LLM → tools → core
}
```

Clean separation: pure data ops call core directly, external data ops go through tools, LLM ops go through skills.
