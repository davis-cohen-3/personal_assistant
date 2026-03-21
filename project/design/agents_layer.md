# Agents Layer

## Overview

The agents layer is the intelligence tier of the system. It manages conversations with the Claude Agent SDK, defines tools the agent can use, and orchestrates multi-step workflows (skills). The agent layer is the **only place** where LLM calls happen and the **only place** where connector reads are composed with core writes.

**Key principle:** Tools are the bridge between the agent and the system. They compose connector reads with core writes, ensuring all external data passes through business logic before persistence. Skills orchestrate tools into multi-step workflows with specific system prompts.

---

## Directory Structure

```
agents/
  client.ts              ← Claude Agent SDK client initialization
  orchestrator.ts        ← Conversation management, tool dispatch, streaming
  tools/                 ← Tool definitions (bridge between agent and system)
    index.ts             ← Tool registry — exports all tools for the orchestrator
    thread-tools.ts      ← fetchInbox, classifyThread, investigateThread
    event-tools.ts       ← syncCalendar, prepMeeting, postMeeting
    task-tools.ts        ← createTask, delegateTask, detectCompletions
    action-tools.ts      ← proposeAction, executeApprovedAction
    people-tools.ts      ← proposePerson, lookupPerson
    briefing-tools.ts    ← assembleBriefing
    read-tools.ts        ← readThread, readEvent, readDocument, searchDocuments
  skills/                ← Pre-composed workflows
    sort-inbox.ts
    investigate-thread.ts
    prep-meeting.ts
    post-meeting.ts
    daily-briefing.ts
    delegate-task.ts
```

---

## Import Rules

| Sublayer | May import from | Must NOT import from |
|---|---|---|
| `agents/tools/` | `core/`, `connectors/`, `infra/`, `shared/` | `db/`, `drizzle-orm`, `routes/` |
| `agents/skills/` | `agents/tools/`, `core/`, `infra/`, `shared/` | `db/`, `connectors/`, `routes/` |
| `agents/orchestrator.ts` | `agents/skills/`, `agents/tools/`, `core/`, `infra/`, `shared/` | `db/`, `connectors/`, `routes/` |
| `agents/client.ts` | `infra/`, `shared/` | Everything else |

**Why skills can't import connectors:** Skills orchestrate tools. Tools handle connector access. This keeps the connector→core composition in one place (tools), not scattered across tools and skills.

**Why skills can import core:** Skills may call core directly for pure data reads (e.g., `tasksCore.getActiveForCompletionCheck`) before deciding which tools to invoke. They don't call core for mutations — that goes through tools.

---

## agents/client.ts — SDK Client

Initializes and exports the Claude Agent SDK client. Single instance, configured once at startup.

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export { client };
```

Model configuration, API key, and other SDK settings are handled here. No business logic.

---

## agents/orchestrator.ts — Conversation Management

The orchestrator is the entry point for all agent interactions. It manages conversation state, registers tools, dispatches skills, and streams responses to the frontend.

### Responsibilities

1. **Conversation state** — Maintains message history (in-memory, single-user)
2. **Tool registration** — Registers all tools from `agents/tools/index.ts` with the Agent SDK
3. **Tool dispatch** — When the agent calls a tool, executes the corresponding tool function
4. **Streaming** — Emits response chunks and tool call events via WebSocket
5. **Skill dispatch** — Routes skill requests to the appropriate skill module
6. **Context loading** — Loads user preferences and profile at conversation start

### Public Functions

#### `chat(db: DB, message: string): Promise<void>`

Processes a user message through the agent. Streams the response via WebSocket.

```typescript
import { Agent } from '@anthropic-ai/agent-sdk';
import { allTools } from './tools';
import * as preferencesCore from '../core/preferences';
import { websocket } from '../infra/websocket';

const conversationHistory: Message[] = [];

export async function chat(db: DB, message: string): Promise<void> {
  // Add user message to history
  conversationHistory.push({ role: 'user', content: message });

  // Load preferences for agent context
  const preferences = await preferencesCore.loadAll();
  const profile = await preferencesCore.getProfile();

  // Create agent with tools
  const agent = new Agent({
    model: 'claude-sonnet-4-6',
    system: buildSystemPrompt(profile, preferences),
    tools: allTools,
  });

  // Run agent with streaming
  const stream = agent.run(conversationHistory);

  for await (const event of stream) {
    switch (event.type) {
      case 'text_delta':
        websocket.broadcast('conversation:chunk', { text: event.text });
        break;

      case 'tool_use':
        // Execute tool and return result
        const result = await executeToolCall(db, event.name, event.input);
        // Broadcast tool actions to frontend (e.g., action:proposed)
        broadcastToolSideEffects(event.name, result);
        break;

      case 'end':
        conversationHistory.push({ role: 'assistant', content: event.response });
        websocket.broadcast('conversation:complete', { messageId: event.id });
        break;
    }
  }
}
```

#### `runSkill(db: DB, skillName: string, params?: Record<string, unknown>): Promise<void>`

Runs a pre-composed skill. Used by routes (Start Day button, Sort Inbox button) and the heartbeat.

```typescript
import * as sortInbox from './skills/sort-inbox';
import * as prepMeeting from './skills/prep-meeting';
import * as postMeeting from './skills/post-meeting';
import * as dailyBriefing from './skills/daily-briefing';

const skillMap = {
  'sort-inbox': sortInbox.run,
  'prep-meeting': prepMeeting.run,
  'post-meeting': postMeeting.run,
  'daily-briefing': dailyBriefing.run,
  'delegate-task': delegateTask.run,
  'investigate-thread': investigateThread.run,
};

export async function runSkill(
  db: DB,
  skillName: string,
  params?: Record<string, unknown>
): Promise<void> {
  const skill = skillMap[skillName];
  if (!skill) throw new ValidationError(`Unknown skill: ${skillName}`);
  await skill(db, params);
}
```

#### `reset(): void`

Clears conversation history. Used for testing or when the user explicitly starts a new conversation.

### Streaming Protocol

The orchestrator streams to the frontend via WebSocket. The route handler returns `202 Accepted` immediately — the response is delivered asynchronously.

| WebSocket Event | Payload | When |
|---|---|---|
| `conversation:chunk` | `{ text: string }` | Each text token from the agent |
| `conversation:action` | `{ toolName: string, status: 'started' \| 'completed' }` | Tool call lifecycle |
| `conversation:complete` | `{ messageId: string }` | Agent finished responding |
| `action:proposed` | `{ action: Action }` | A tool created a proposed action |
| `task:created` | `{ task: Task }` | A tool created a task |
| `person:proposed` | `{ person: Person }` | A tool proposed a new contact |
| `system:error` | `{ error: string }` | Unrecoverable agent error |

---

## agents/tools/ — Tool Definitions

Tools are the bridge between the agent (LLM) and the system. Each tool is a function the agent can call, defined with a name, description, input schema, and handler.

### The Rule

> **Tools call connectors for external reads. Tools call core for all business logic, validation, persistence, and state transitions. Tools never call db/ directly.**

### Tool Registration

All tools are registered in `agents/tools/index.ts` and provided to the orchestrator:

```typescript
// agents/tools/index.ts
import { threadTools } from './thread-tools';
import { eventTools } from './event-tools';
import { taskTools } from './task-tools';
import { actionTools } from './action-tools';
import { peopleTools } from './people-tools';
import { briefingTools } from './briefing-tools';
import { readTools } from './read-tools';

export const allTools = [
  ...threadTools,
  ...eventTools,
  ...taskTools,
  ...actionTools,
  ...peopleTools,
  ...briefingTools,
  ...readTools,
];
```

### Tool Shape

Each tool follows this pattern:

```typescript
{
  name: 'fetch_inbox',
  description: 'Fetch recent email threads from Gmail and persist them.',
  input_schema: { type: 'object', properties: { ... }, required: [...] },
  handler: async (db: DB, input: FetchInboxInput) => { ... }
}
```

---

### Thread Tools

#### `fetch_inbox`

Fetches recent threads from Gmail and persists via core.

```typescript
// Connector: emailClient.searchThreads (external read)
// Core: threadsCore.upsertFromGmail (persist)
```

#### `classify_thread`

Classifies a single thread into a bucket. The agent provides the classification based on its analysis.

```typescript
// Core: threadsCore.classifyAndAssign (persist classification + bucket assignment)
```

#### `investigate_thread`

Deep analysis of a thread — extracts people, tasks, and proposed actions.

```typescript
// Connector: emailClient.readThread (full thread content for LLM analysis)
// Core: threadsCore.applyInvestigationPlan (persist results atomically)
```

---

### Event Tools

#### `sync_calendar`

Fetches events from Google Calendar and persists via core.

```typescript
// Connector: calendarClient.listEvents (external read)
// Core: eventsCore.upsertFromCalendar (persist)
```

#### `save_meeting_brief`

Saves an agent-generated meeting brief.

```typescript
// Connector: emailClient.searchThreads, driveClient.searchDocuments (gather context)
// Core: eventsCore.saveBrief (persist brief)
```

#### `apply_post_meeting_plan`

Persists post-meeting processing results (tasks, actions).

```typescript
// Connector: emailClient.searchThreads (check for follow-up threads)
// Core: eventsCore.applyPostMeetingPlan (persist atomically)
```

---

### Task Tools

#### `create_task`

Creates a task with validation (delegation checks, source validation).

```typescript
// Core: tasksCore.create (validation + persist)
```

#### `transition_task`

Advances a task's status per the state machine.

```typescript
// Core: tasksCore.transition (validation + persist)
```

#### `delegate_task`

Creates a delegation action (proposed email + task update).

```typescript
// Core: actionsCore.create (propose delegation action)
```

---

### Action Tools {#action-tools}

#### `propose_action`

Creates a proposed action for user approval.

```typescript
// Core: actionsCore.create (persist proposal)
```

#### `execute_approved_action`

Executes an approved action via the appropriate connector, then marks as executed/failed in core.

```typescript
import { emailClient } from '../../connectors';
import { calendarClient } from '../../connectors';
import { driveClient } from '../../connectors';
import * as actionsCore from '../../core/actions';

async function executeApprovedAction(db: DB, actionId: string): Promise<Action> {
  const action = await actionsCore.getById(db, actionId);

  // Dispatch to connector based on operation
  try {
    const result = await dispatchToConnector(action);
    return await actionsCore.markExecuted(db, actionId, result);
  } catch (err) {
    await actionsCore.markFailed(db, actionId, err.message);
    throw err;
  }
}

function dispatchToConnector(action: Action): Promise<Record<string, unknown>> {
  switch (action.operation) {
    case 'email.send':
    case 'email.draft_reply':
    case 'email.draft_new':
      return emailClient.sendEmail(action.input as SendEmailParams);

    case 'calendar.create_event':
      return calendarClient.createEvent(action.input as CreateEventParams);

    case 'calendar.update_event':
      return calendarClient.updateEvent(
        action.input.eventId as string,
        action.input as UpdateEventParams
      );

    case 'calendar.cancel_event':
      return calendarClient.cancelEvent(action.input.eventId as string).then(() => ({}));

    case 'doc.create':
      return driveClient.createDocument(action.input as CreateDocParams);

    default:
      throw new ValidationError(`Unknown operation: ${action.operation}`);
  }
}
```

This dispatch table was previously in `core/actions.ts`. Moving it to the tool layer keeps core pure and puts connector access where it belongs.

---

### People Tools

#### `propose_person`

Proposes a new contact discovered in threads or events.

```typescript
// Core: peopleCore.create(db, data, 'agent') (validation + persist as proposed)
```

#### `lookup_person`

Looks up a person by email, including soft-deleted records.

```typescript
// Core: peopleDb (via core) — returns person if found
```

#### `resolve_participant`

Resolves a participant by ID, with Calendar API fallback for soft-deleted people.

```typescript
// Core: eventsCore.resolveParticipant (DB lookup)
// Connector: calendarClient.getEvent (fallback for soft-deleted)
```

---

### Read Tools

Read-only tools for giving the agent context. These call connectors directly since they don't mutate state.

#### `read_thread`

Reads full thread content from Gmail.

```typescript
// Connector: emailClient.readThread (external read, no persistence needed)
```

#### `read_event`

Gets event details from DB.

```typescript
// Core: eventsCore.getById (DB read)
```

#### `read_document`

Reads document content from Google Drive.

```typescript
// Connector: driveClient.getDocument (external read)
```

#### `search_documents`

Searches Google Drive for relevant documents.

```typescript
// Connector: driveClient.searchDocuments (external read)
```

---

### Briefing Tools

#### `assemble_briefing`

Gathers data from multiple core modules and persists the briefing.

```typescript
// Core: tasksCore.list, eventsCore.list, actionsCore.list, threadsCore.list (reads)
// Core: briefingsCore.save (persist)
```

---

## agents/skills/ — Pre-Composed Workflows

Skills are not separate agents — they're pre-composed workflows with specific system prompts that guide the agent to use tools in a particular sequence. Each skill creates an ephemeral agent conversation.

### Skill Structure

```typescript
// agents/skills/sort-inbox.ts
import { Agent } from '@anthropic-ai/agent-sdk';
import { client } from '../client';
import { threadTools } from '../tools/thread-tools';
import { readTools } from '../tools/read-tools';
import * as bucketsCore from '../../core/buckets';

const SYSTEM_PROMPT = `You are sorting an email inbox. For each thread:
1. Read the thread content
2. Classify by urgency, action needed, and category
3. Assign to the most appropriate bucket

Available buckets will be provided. Classify every thread — do not skip any.`;

export async function run(db: DB, params?: { threadIds?: string[] }): Promise<void> {
  const buckets = await bucketsCore.list(db);

  const agent = new Agent({
    model: 'claude-sonnet-4-6',
    system: SYSTEM_PROMPT + `\n\nBuckets:\n${formatBuckets(buckets)}`,
    tools: [...threadTools, ...readTools],
  });

  // Run with the thread list as the initial message
  await agent.run([{
    role: 'user',
    content: formatThreadsForClassification(params?.threadIds),
  }]);
}
```

### Skill Catalog

| Skill | Tools Used | Triggered By |
|---|---|---|
| `sort-inbox` | `fetch_inbox`, `read_thread`, `classify_thread` | Start Day, heartbeat, manual button |
| `investigate-thread` | `read_thread`, `propose_person`, `create_task`, `propose_action` | Agent deep-dive on a thread |
| `prep-meeting` | `read_event`, `read_thread`, `search_documents`, `read_document`, `save_meeting_brief` | Manual button, Start Day |
| `post-meeting` | `read_event`, `read_thread`, `search_documents`, `create_task`, `propose_action`, `apply_post_meeting_plan` | Heartbeat (ended meetings) |
| `daily-briefing` | `fetch_inbox`, `sync_calendar`, `assemble_briefing` | Start Day button |
| `delegate-task` | `read_thread`, `propose_action`, `create_task` | Agent or user request |

### Skills vs Direct Tool Calls

The orchestrator can use tools directly (in response to ad-hoc user chat) or run skills (for structured workflows). The distinction:

- **Direct tool call:** User says "check my email" → agent calls `fetch_inbox` tool
- **Skill:** User hits "Start Day" → route calls `orchestrator.runSkill('daily-briefing')` → skill creates focused agent with specific prompt + tool subset

Skills exist because some workflows need a specific prompt, a specific tool subset, and a specific sequence to produce reliable results. The agent could theoretically do it ad-hoc, but skills encode the "right way" to do common workflows.

---

## Conversation Flow

### Chat (ad-hoc user interaction)

```
1. User sends message via POST /api/agent/chat
2. routes/agent.ts validates auth, calls orchestrator.chat(db, message)
3. orchestrator adds message to history, creates Agent with all tools
4. Agent SDK streams response:
   - Text chunks → WebSocket broadcast (conversation:chunk)
   - Tool calls → orchestrator executes tool handler → result returned to agent
   - Tool side effects → WebSocket broadcast (action:proposed, task:created, etc.)
5. Stream ends → WebSocket broadcast (conversation:complete)
6. Route returns 202 Accepted (response delivered via WebSocket)
```

### Skill (structured workflow)

```
1. User hits "Start Day" button via POST /api/agent/start-day
2. routes/agent.ts validates auth, calls orchestrator.runSkill(db, 'daily-briefing')
3. Skill creates ephemeral agent with focused prompt + tool subset
4. Ephemeral agent runs tools in guided sequence:
   - fetch_inbox → sync_calendar → prep upcoming meetings → assemble_briefing
5. Each tool call may produce WebSocket events (new threads, briefs, etc.)
6. Skill completes → briefing ready event
7. Route returns 202 Accepted
```

### Heartbeat (background)

```
1. Cron fires every 5 minutes
2. heartbeat.ts calls tools directly (fetchInbox, syncCalendar) for data sync
3. heartbeat.ts calls core directly (flagOverdue, expireStale) for pure logic
4. heartbeat.ts calls skills (classifyNewThreads, detectCompletions) for LLM analysis
5. Each step independent — failures logged, don't block next step
6. WebSocket events broadcast for any state changes
```

---

## Error Handling in the Agent Layer

| Scenario | Handling |
|---|---|
| Tool function throws `NotFoundError` | Return error context to agent — agent explains to user |
| Tool function throws `ValidationError` | Return error context to agent — agent explains constraint |
| Tool function throws `ExternalServiceError` | Return error context to agent — agent reports service issue |
| Connector times out / rate limited | Rate limiter retries. If exhausted, tool wraps as `ExternalServiceError` |
| Agent SDK error (model overloaded, etc.) | Orchestrator catches, broadcasts `system:error` via WebSocket |
| Skill fails mid-workflow | Partial results already persisted via tools. Failure logged. User notified via WebSocket |

The agent never sees raw stack traces. Tool handlers catch domain exceptions and return structured error objects that the agent can reason about and present to the user.

---

## Testing Strategy

| Layer | Test approach | Mocking |
|---|---|---|
| `agents/tools/` | Unit tests per tool | Mock connectors (module mock), real or in-memory DB for core |
| `agents/skills/` | Integration tests per skill | Mock Agent SDK responses, mock tools |
| `agents/orchestrator.ts` | Integration test for chat flow | Mock Agent SDK, mock skills |
| `agents/client.ts` | Not tested directly | — |

Tools are the most important layer to test because they handle the connector→core composition. Each tool test verifies:
1. Connector is called with correct params
2. Core is called with the connector's response
3. Errors from either layer are handled correctly
