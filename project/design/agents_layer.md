# Agents Layer

## Overview

The agents layer is the intelligence tier of the system. It manages conversations with the Claude Agent SDK, defines tools the agent can use, and orchestrates multi-step workflows (skills). The agent layer is the **only place** where LLM calls happen.

**Key principle:** Tools are thin wrappers that expose service methods to the LLM. Services own all business logic and connector orchestration. Tools just define the schema and call the service.

---

## Directory Structure

```
agents/
  client.ts              ← Claude Agent SDK client initialization
  orchestrator.ts        ← Conversation management, tool dispatch, streaming
  tools/                 ← Tool definitions (thin wrappers over services)
    index.ts             ← Tool registry — exports all tools for the orchestrator
    thread-tools.ts      ← fetchInbox, classifyThread, investigateThread
    event-tools.ts       ← syncCalendar, prepMeeting, postMeeting
    task-tools.ts        ← createTask, delegateTask, detectCompletions
    action-tools.ts      ← proposeAction, approveAction
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
| `agents/tools/` | `services/`, `infra/`, `shared/` | `db/`, `drizzle-orm`, `connectors/`, `routes/` |
| `agents/skills/` | `agents/tools/`, `services/`, `infra/`, `shared/` | `db/`, `drizzle-orm`, `connectors/`, `routes/` |
| `agents/orchestrator.ts` | `agents/skills/`, `agents/tools/`, `services/`, `infra/`, `shared/` | `db/`, `drizzle-orm`, `connectors/`, `routes/` |
| `agents/client.ts` | `infra/`, `shared/` | Everything else |

**Tools never import connectors.** Services own connector access. A tool's job is to define the schema and call the service method — nothing more.

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
import * as preferencesService from '../services/preferences';
import { websocket } from '../infra/websocket';

const conversationHistory: Message[] = [];

export async function chat(db: DB, message: string): Promise<void> {
  // Add user message to history
  conversationHistory.push({ role: 'user', content: message });

  // Load preferences for agent context
  const preferences = await preferencesService.loadAll();
  const profile = await preferencesService.getProfile();

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
        // Execute tool — just calls the service method
        const result = await executeToolCall(db, event.name, event.input);
        // Broadcast side effects to frontend (e.g., action:proposed)
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
import * as delegateTask from './skills/delegate-task';
import * as investigateThread from './skills/investigate-thread';

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

Tools are thin wrappers that expose service methods to the LLM. Each tool defines a name, description, input schema, and a handler that calls the corresponding service method.

### The Rule

> **Tools call services. That's it.** Services handle connectors, DB, validation, state machines — everything. Tools just define the agent-facing interface.

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

Each tool is a thin wrapper. The handler is typically a one-liner:

```typescript
// Example: agents/tools/thread-tools.ts
import * as threadsService from '../../services/threads';

export const threadTools = [
  {
    name: 'fetch_inbox',
    description: 'Fetch recent email threads from Gmail and persist them.',
    input_schema: { type: 'object', properties: {}, required: [] },
    handler: async (db: DB) => {
      return await threadsService.fetchNewThreads(db);
    },
  },
  {
    name: 'classify_thread',
    description: 'Classify a thread and assign it to a bucket.',
    input_schema: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
        classification: { type: 'object' },
        bucketId: { type: 'string' },
      },
      required: ['threadId', 'classification', 'bucketId'],
    },
    handler: async (db: DB, input: ClassifyThreadInput) => {
      return await threadsService.classifyAndAssign(db, input.threadId, input.classification, input.bucketId);
    },
  },
  // ... more tools
];
```

### Tool Catalog

#### Thread Tools

| Tool | Service Method | What It Does |
|---|---|---|
| `fetch_inbox` | `threadsService.fetchNewThreads` | Fetch from Gmail + upsert |
| `classify_thread` | `threadsService.classifyAndAssign` | Set classification + bucket |
| `investigate_thread` | `threadsService.applyInvestigationPlan` | Persist people + tasks + actions atomically |

#### Event Tools

| Tool | Service Method | What It Does |
|---|---|---|
| `sync_calendar` | `eventsService.syncFromCalendar` | Fetch from Calendar + upsert |
| `save_meeting_brief` | `eventsService.saveBrief` | Persist agent-generated brief |
| `apply_post_meeting_plan` | `eventsService.applyPostMeetingPlan` | Persist tasks + actions atomically |

#### Task Tools

| Tool | Service Method | What It Does |
|---|---|---|
| `create_task` | `tasksService.create` | Validate + persist |
| `transition_task` | `tasksService.transition` | Validate state machine + persist |

#### Action Tools

| Tool | Service Method | What It Does |
|---|---|---|
| `propose_action` | `actionsService.create` | Persist proposal |
| `approve_action` | `actionsService.approve` | Validate + dispatch to connector + mark result |

#### People Tools

| Tool | Service Method | What It Does |
|---|---|---|
| `propose_person` | `peopleService.create(db, data, 'agent')` | Validate + persist as proposed |
| `lookup_person` | `peopleService.getByEmail` | Look up by email |
| `resolve_participant` | `eventsService.resolveParticipant` | DB lookup + Calendar fallback |

#### Read Tools

| Tool | Service Method | What It Does |
|---|---|---|
| `read_thread` | `threadsService.readFullThread` | Get full thread content from Gmail via service |
| `read_event` | `eventsService.getById` | Get event from DB |
| `read_document` | `documentsService.getDocument` | Get doc content from Drive via service |
| `search_documents` | `documentsService.searchDocuments` | Search Drive via service |

#### Briefing Tools

| Tool | Service Method | What It Does |
|---|---|---|
| `assemble_briefing` | `briefingsService.save` | Persist briefing |

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
import * as bucketsService from '../../services/buckets';

const SYSTEM_PROMPT = `You are sorting an email inbox. For each thread:
1. Read the thread content
2. Classify by urgency, action needed, and category
3. Assign to the most appropriate bucket

Available buckets will be provided. Classify every thread — do not skip any.`;

export async function run(db: DB, params?: { threadIds?: string[] }): Promise<void> {
  const buckets = await bucketsService.list(db);

  const agent = new Agent({
    model: 'claude-sonnet-4-6',
    system: SYSTEM_PROMPT + `\n\nBuckets:\n${formatBuckets(buckets)}`,
    tools: [...threadTools, ...readTools],
  });

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

The orchestrator can use tools directly (in response to ad-hoc user chat) or run skills (for structured workflows):

- **Direct tool call:** User says "check my email" → agent calls `fetch_inbox` tool
- **Skill:** User hits "Start Day" → route calls `orchestrator.runSkill('daily-briefing')` → skill creates focused agent with specific prompt + tool subset

Skills encode the "right way" to do common workflows. The agent could do it ad-hoc, but skills produce more reliable results via focused prompts and constrained tool sets.

---

## Conversation Flow

### Chat (ad-hoc user interaction)

```
1. User sends message via POST /api/agent/chat
2. routes/agent.ts validates auth, calls orchestrator.chat(db, message)
3. orchestrator adds message to history, creates Agent with all tools
4. Agent SDK streams response:
   - Text chunks → WebSocket broadcast (conversation:chunk)
   - Tool calls → orchestrator executes tool handler (which calls service) → result returned to agent
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
5. Each tool call invokes a service method, which may produce WebSocket events
6. Skill completes → briefing ready event
7. Route returns 202 Accepted
```

### Heartbeat (background)

```
1. Cron fires every 5 minutes
2. heartbeat.ts calls services directly for data sync + business logic
3. heartbeat.ts calls skills for LLM analysis
4. Each step independent — failures logged, don't block next step
5. WebSocket events broadcast for any state changes
```

---

## Error Handling in the Agent Layer

| Scenario | Handling |
|---|---|
| Tool's service call throws `NotFoundError` | Return error context to agent — agent explains to user |
| Tool's service call throws `ValidationError` | Return error context to agent — agent explains constraint |
| Tool's service call throws `ExternalServiceError` | Return error context to agent — agent reports service issue |
| Agent SDK error (model overloaded, etc.) | Orchestrator catches, broadcasts `system:error` via WebSocket |
| Skill fails mid-workflow | Partial results already persisted via service calls. Failure logged. User notified via WebSocket |

The agent never sees raw stack traces. Tool handlers catch domain exceptions and return structured error objects that the agent can reason about and present to the user.

---

## Testing Strategy

| Layer | Test approach | Mocking |
|---|---|---|
| `agents/tools/` | Unit tests per tool | Mock services |
| `agents/skills/` | Integration tests per skill | Mock Agent SDK responses, mock tools |
| `agents/orchestrator.ts` | Integration test for chat flow | Mock Agent SDK, mock skills |
| `agents/client.ts` | Not tested directly | — |

Tools are trivially testable since they're thin wrappers — you're really testing that the right service method is called with the right args. The real logic lives in services, which have their own tests.
