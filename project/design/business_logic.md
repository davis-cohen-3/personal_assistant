# Business Logic Modules

## Overview

Every module in `core/` exports plain async functions — no classes, no `this`. Functions receive `db: DB` as their first argument (Drizzle instance or transaction handle). Core is the single authority for business logic: routes call core, agents call core, the heartbeat calls core. Nobody else owns validation, state transitions, or transaction boundaries.

**Core handles data operations only** — no LLM calls, no classification, no message drafting. Agent-driven workflows (sort inbox, prep meeting, briefing generation, completion detection) live in `agents/`, which calls `core/` for persistence.

**Import rules:** `core/` imports from `db/`, `connectors/`, `infra/`, and `shared/` only. Never from `drizzle-orm`, `agents/`, or `routes/`. Connectors are module-level singletons — imported directly, not passed as parameters. See [backend_architecture.md](backend_architecture.md#layer-import-rules).

**Error handling:** Core throws domain exceptions (`NotFoundError`, `ConflictError`, `ValidationError`, `ExternalServiceError`). Routes map to HTTP status codes. Agents map to user-facing messages. See [backend_architecture.md](backend_architecture.md#error-handling).

---

## core/errors.ts

Domain exception hierarchy. Defined here, thrown by all core modules, caught by callers.

```typescript
NotFoundError(entity: string, id: string)    // 404
ConflictError(message: string)               // 409 — duplicate email, duplicate bucket name
ValidationError(message: string)             // 400 — invalid transition, bad input, constraint violation
ExternalServiceError(message: string)        // 502 — Gmail/Calendar/Drive failure
```

---

## core/people.ts

### Public Functions

#### `list(db: DB, query: ListPeopleQuery): Promise<PaginatedResult<Person>>`

Returns paginated people. Filters by status, relationship type, and search (case-insensitive prefix match on name/email). Excludes soft-deleted records by default.

#### `getById(db: DB, id: string): Promise<Person>`

Returns a single person. Throws `NotFoundError` if not found or soft-deleted.

#### `create(db: DB, data: CreatePersonInput, initiatedBy: 'user' | 'agent'): Promise<Person>`

Creates a person record.

- **Validation:**
  - Checks `findByEmailIncludeDeleted` — if a record exists with `status: rejected` and `deleted_at` set, throws `ConflictError` (prevents re-proposal of rejected contacts).
  - If an active record exists with the same email, throws `ConflictError`.
- **Status assignment:** `user` → `confirmed`. `agent` → `proposed`.
- **Sets** `source` based on context: `user_created`, `inbox_scan`, or `calendar_event`.

#### `update(db: DB, id: string, data: UpdatePersonInput): Promise<Person>`

Updates mutable fields (name, role, company, relationship_type, context, notes). Throws `NotFoundError` if not found. Does not change status — use `confirm`/`reject` for that.

#### `confirm(db: DB, id: string): Promise<Person>`

Transitions `proposed` → `confirmed`. Throws `ValidationError` if not in `proposed` status.

#### `reject(db: DB, id: string): Promise<Person>`

Transitions `proposed` → `rejected`, then soft-deletes (sets `deleted_at`). Throws `ValidationError` if not in `proposed` status. Runs in a transaction — status change + soft delete are atomic.

#### `remove(db: DB, id: string): Promise<void>`

Soft-deletes a person (sets `deleted_at`). Throws `NotFoundError` if not found. Works on any status.

#### `updateLastInteraction(db: DB, id: string, timestamp: Date): Promise<void>`

Updates `last_interaction` if the given timestamp is more recent than the current value. Called by threads and events modules when new activity involving this person is detected.

### State Machine

```
proposed → confirmed    (user-initiated: confirm)
proposed → rejected     (user-initiated: reject)
```

No agent-initiated or system-initiated transitions. People status is strictly user-controlled.

### Connector Usage

None. People is a local-only entity. Interaction history is derived by querying Gmail API via `threads.ts` or `events.ts`, not by people.ts directly.

### Cross-Module Calls

- `reject` is self-contained — no cross-module calls.
- Other modules call `people.updateLastInteraction` and `people.create` (agent-initiated proposals from thread/event processing).

---

## core/threads.ts

### Public Functions

#### `list(db: DB, query: ListThreadsQuery): Promise<PaginatedResult<Thread>>`

Returns paginated threads. Filters by `bucketId`. Sorted by `last_message_at` descending.

#### `getById(db: DB, id: string): Promise<Thread>`

Returns a single thread. Throws `NotFoundError` if not found.

#### `update(db: DB, id: string, data: UpdateThreadInput): Promise<Thread>`

Moves a thread to a different bucket. Validates the target bucket exists — throws `NotFoundError` if it doesn't.

#### `upsertFromGmail(db: DB, gmailThread: GmailThreadSummary): Promise<Thread>`

Creates or updates a thread record from Gmail API data. Matches on `gmail_thread_id`. Used by Sort Inbox and heartbeat.

#### `classifyAndAssign(db: DB, threadId: string, classification: Classification, bucketId: string): Promise<Thread>`

Sets the classification JSONB and assigns to a bucket. Validates bucket exists. Called by the Sort Inbox skill after agent classification.

#### `batchClassifyAndAssign(db: DB, assignments: Array<{ threadId: string, classification: Classification, bucketId: string }>): Promise<Thread[]>`

Batch version for Sort Inbox. **Not transactional** — each thread is independent, partial success is valid (per [backend_architecture.md](backend_architecture.md#transaction-boundaries)). Logs failures, continues with remaining threads.

#### `reassignThreads(db: DB, fromBucketId: string, buckets: Bucket[]): Promise<Thread[]>`

Reassigns all threads from a given bucket to other buckets. Called within a transaction by `buckets.remove`. The agent re-classifies each thread against the remaining bucket set, then calls `classifyAndAssign` per thread.

- **Validation:** `buckets` array must not be empty — throws `ValidationError` if no remaining buckets.
- This function is always called inside a transaction opened by the caller.

#### `fetchNewThreads(db: DB): Promise<Thread[]>`

Fetches recent threads from Gmail via `emailClient` singleton, upserts them into the database. Returns the new/updated thread records. Used by the agent's Sort Inbox skill and by the heartbeat.

- **Connector usage:** Calls `emailClient.searchThreads`. Wraps connector failures in `ExternalServiceError`.

#### `applyInvestigationPlan(db: DB, threadId: string, plan: InvestigationPlan): Promise<void>`

Persists the results of an agent thread investigation. **Transactional** — creates people + tasks + actions atomically.

```typescript
await db.transaction(async (tx) => {
  for (const person of plan.newPeople) {
    await peopleCore.create(tx, person, 'agent');
  }
  for (const task of plan.extractedTasks) {
    await taskCore.create(tx, task, 'agent');
  }
  for (const action of plan.proposedActions) {
    await actionCore.create(tx, action);
  }
});
```

The agent (in `agents/skills/investigate-thread.ts`) fetches full thread content from Gmail, does LLM analysis, builds the `InvestigationPlan`, and passes it here for persistence.

### Connector Usage

- `fetchNewThreads` imports `emailClient` singleton to fetch thread list from Gmail.

### Cross-Module Calls

- `applyInvestigationPlan` calls `peopleCore.create`, `taskCore.create`, and `actionCore.create` inside a transaction.
- `reassignThreads` is called by `bucketCore.remove` within the caller's transaction.

---

## core/buckets.ts

### Public Functions

#### `list(db: DB): Promise<Bucket[]>`

Returns all buckets sorted by `sort_order`. No pagination — buckets are a small, fixed set.

#### `create(db: DB, data: CreateBucketInput): Promise<Bucket>`

Creates a new bucket.

- **Validation:**
  - Name must be unique — throws `ConflictError` on duplicate.
  - If `sortOrder` is not provided, appends to end (max existing + 1).
- **Returns:** `{ bucket, resortNeeded: true }` — the caller (route or agent) is responsible for triggering a re-sort via the agent system.

#### `update(db: DB, id: string, data: UpdateBucketInput): Promise<Bucket>`

Updates bucket name, description, or sort order.

- **Validation:**
  - Throws `NotFoundError` if bucket doesn't exist.
  - Throws `ConflictError` if new name conflicts with existing bucket.
- **Returns:** `{ bucket, resortNeeded: boolean }` — `true` if `description` changed (the field used by the agent for classification). Name-only or sort-order-only changes do not require re-sort.

#### `remove(db: DB, id: string): Promise<void>`

Deletes a bucket after reassigning its threads to remaining buckets.

- **Validation:**
  - Throws `NotFoundError` if bucket doesn't exist.
  - Throws `ValidationError` if this is the last remaining bucket — can't leave threads with nowhere to go.
- **Transactional:** Reassign threads + delete bucket inside a single transaction. Per [backend_architecture.md](backend_architecture.md#transaction-boundaries), partial state (threads pointing to deleted bucket) is broken state.

```typescript
await db.transaction(async (tx) => {
  const remaining = await bucketsDb.listExcluding(tx, id);
  await threadsCore.reassignThreads(tx, id, remaining);
  await bucketsDb.remove(tx, id);
});
```

#### `seed(db: DB): Promise<Bucket[]>`

Creates default buckets on initial setup. Idempotent — skips if buckets already exist.

### Cross-Module Calls

- `remove` calls `threadsCore.reassignThreads` inside its transaction.

---

## core/events.ts

### Public Functions

#### `list(db: DB, query: ListEventsQuery): Promise<PaginatedResult<Event>>`

Returns paginated events within a date range (`from`, `to`). Sorted by `start_time` ascending.

#### `getById(db: DB, id: string): Promise<Event>`

Returns a single event with all metadata. Throws `NotFoundError` if not found.

#### `getBrief(db: DB, id: string): Promise<EventBrief>`

Returns the meeting brief for an event. Throws `NotFoundError` if event not found or no brief has been generated yet.

#### `upsertFromCalendar(db: DB, calendarEvent: CalendarEventSummary): Promise<Event>`

Creates or updates an event record from Google Calendar API data. Matches on `google_event_id`. Resolves participant emails to People IDs via `peopleDb.findByEmail`. Unresolved participants are stored by email for later resolution.

#### `prepMeeting(db: DB, id: string, emailClient: EmailClient, calendarClient: CalendarClient, driveClient: DriveClient): Promise<{ jobId: string }>`

Entry point for the Prep Meeting skill. Returns a job ID — results arrive via WebSocket.

Orchestrates:
1. Reads event details via `calendarClient.getEvent`.
2. Looks up participants in People.
3. Searches related threads via `emailClient.searchThreads` (by participant emails and event topic).
4. Searches related documents via `driveClient.searchDocuments`.
5. Generates pre-metadata.
6. Builds and saves the meeting brief.

- **Connector usage:** Calls `CalendarClient.getEvent`, `EmailClient.searchThreads`, `DriveClient.searchDocuments`. Each call is independent — partial failure is acceptable (brief is generated with available data, missing sections noted).

#### `processPostMeeting(db: DB, id: string, emailClient: EmailClient, driveClient: DriveClient): Promise<PostMeetingResult>`

Runs post-meeting processing for an ended event. **Transactional** — updates event + creates tasks + creates actions atomically (per [backend_architecture.md](backend_architecture.md#transaction-boundaries)).

1. Checks for follow-up threads involving meeting participants.
2. Checks for new/updated documents (meeting notes, action items).
3. Extracts action items → proposes as Tasks.
4. Populates `post_metadata` on event record.

```typescript
await db.transaction(async (tx) => {
  await eventsDb.updatePostMetadata(tx, id, postMetadata);
  for (const task of extractedTasks) {
    await taskCore.create(tx, task, 'agent');
  }
  for (const action of proposedActions) {
    await actionCore.create(tx, action);
  }
});
```

- **Connector usage:** Calls `EmailClient.searchThreads` and `DriveClient.searchDocuments`. Wraps failures in `ExternalServiceError`.

#### `syncFromCalendar(db: DB, calendarClient: CalendarClient, timeRange: { from: Date, to: Date }): Promise<Event[]>`

Fetches events from Google Calendar for the given range and upserts them. Used by heartbeat and Start Day.

- **Connector usage:** Calls `CalendarClient.listEvents`. Non-transactional — each event is independent.

### Heartbeat Logic

- **Detect ended meetings:** Queries events where `end_time < now` and `post_metadata IS NULL`. For each, calls `processPostMeeting`. Each event is processed independently — one failure doesn't block others.
- **Sync calendar changes:** Calls `syncFromCalendar` to detect new/modified events.

### Cross-Module Calls

- `processPostMeeting` calls `taskCore.create` and `actionCore.create` inside its transaction.
- `upsertFromCalendar` calls `peopleDb.findByEmail` (db layer, not core) to resolve participant IDs.

---

## core/tasks.ts

### Public Functions

#### `list(db: DB, query: ListTasksQuery): Promise<PaginatedResult<Task>>`

Returns paginated tasks. Filters by status, priority, `delegatedTo`, and `dueBefore`. Sorted by priority (urgent first), then due date (soonest first), then `created_at`.

#### `getById(db: DB, id: string): Promise<Task>`

Returns a single task. Throws `NotFoundError` if not found.

#### `create(db: DB, data: CreateTaskInput, initiatedBy: 'user' | 'agent'): Promise<Task>`

Creates a task.

- **Validation:**
  - If `delegatedTo` is set, validates the person exists and is `confirmed` — throws `ValidationError` if person is `proposed` or `rejected` ("can't delegate to an unconfirmed person").
  - If `sourceId` is set, validates the source entity exists.
- **Status assignment:** `user` → `confirmed`. `agent` → `proposed`.
- **Default priority:** `normal` if not specified.

#### `update(db: DB, id: string, data: UpdateTaskInput): Promise<Task>`

Updates mutable fields (title, description, priority, due_date, delegated_to).

- **Validation:**
  - Throws `NotFoundError` if task doesn't exist.
  - If changing `delegatedTo`, validates the person exists and is `confirmed`.
  - Cannot update a `complete` or `rejected` task — throws `ValidationError`.

#### `transition(db: DB, id: string, to: TaskStatus): Promise<Task>`

Advances task status per the state machine. Throws `ValidationError` if the transition is not allowed.

- **Validation rules per transition:**
  - `proposed → confirmed`: No additional guards.
  - `proposed → rejected`: No additional guards.
  - `confirmed → in_progress`: No additional guards.
  - `in_progress → complete_proposed`: Only agent-initiated. Agent detected completion signals.
  - `in_progress → overdue`: Only system-initiated (heartbeat). Requires `due_date < now`.
  - `complete_proposed → complete`: Only user-initiated. User confirms the task is done.
  - `complete_proposed → in_progress`: User rejects completion proposal — task goes back to in_progress.
  - `overdue → in_progress`: User-initiated. User acknowledges and resumes work.
  - `overdue → complete_proposed`: Agent-initiated. Agent detected completion despite overdue status.

#### `flagOverdue(db: DB): Promise<Task[]>`

Finds all tasks with status `in_progress` and `due_date < now`, transitions them to `overdue`. Returns the newly overdue tasks. Called by heartbeat.

#### `detectCompletions(db: DB, emailClient: EmailClient): Promise<Task[]>`

Agent-driven: reviews in-progress and overdue tasks against recent thread activity to detect potential completions. For each detected completion, transitions to `complete_proposed` and creates a proposed action. Returns tasks with proposed completions. Called by heartbeat.

### State Machine

```
proposed ──→ confirmed ──→ in_progress ──→ complete_proposed ──→ complete
   │                            │                │
   └──→ rejected                └──→ overdue     └──→ in_progress
                                      │                (user rejects completion)
                                      ├──→ in_progress
                                      │    (user resumes)
                                      └──→ complete_proposed
                                           (agent detects completion)
```

| Transition | Initiated By |
|---|---|
| `proposed → confirmed` | User |
| `proposed → rejected` | User |
| `confirmed → in_progress` | User |
| `in_progress → complete_proposed` | Agent |
| `in_progress → overdue` | System (heartbeat) |
| `complete_proposed → complete` | User |
| `complete_proposed → in_progress` | User |
| `overdue → in_progress` | User |
| `overdue → complete_proposed` | Agent |

### Heartbeat Logic

- **Flag overdue:** `flagOverdue` finds in-progress tasks past due date, transitions to `overdue`.
- **Detect completions:** `detectCompletions` reviews active tasks against recent activity, proposes completions.

### Cross-Module Calls

- `detectCompletions` calls `actionCore.create` to create proposed completion actions.
- Created by `threadsCore.investigateThread` and `eventsCore.processPostMeeting` inside their transactions.

---

## core/actions.ts

### Public Functions

#### `list(db: DB, query: ListActionsQuery): Promise<PaginatedResult<Action>>`

Returns paginated actions. Filters by status, entity_type, entity_id, and initiated_by. Sorted by `created_at` descending.

#### `getById(db: DB, id: string): Promise<Action>`

Returns a single action with full detail (input/output JSONB). Throws `NotFoundError` if not found.

#### `create(db: DB, data: CreateActionInput): Promise<Action>`

Creates an action record.

- **Status assignment:**
  - Side-effect operations (`email.send`, `calendar.create`, `doc.create`, etc.) → `proposed`.
  - Read-only operations (`email.read_thread`, `doc.find`, etc.) → `executed` immediately.
- **Sets** `created_at`. `executed_at` set only for read-only operations logged as immediately executed.

#### `approve(db: DB, id: string, editedInput?: Record<string, unknown>): Promise<Action>`

Approves a proposed action and triggers execution. Follows the split-transaction pattern from [backend_architecture.md](backend_architecture.md#side-effect-actions-split-transaction).

- **Validation:**
  - Throws `NotFoundError` if action doesn't exist.
  - Throws `ValidationError` if not in `proposed` status ("can't approve a non-proposed action").
  - Throws `ValidationError` if action has expired.
- **If `editedInput` provided:** Merges over original `input` before execution.

**Execution flow (split transaction):**

```typescript
// Step 1: Mark approved (DB write)
await actionsDb.transition(db, id, 'approved');

// Step 2: Execute external side effect (outside transaction)
try {
  const result = await executeExternalOperation(action, connectors);

  // Step 3a: Mark executed (DB write)
  await actionsDb.markExecuted(db, id, result);
} catch (err) {
  // Step 3b: Mark failed (DB write)
  await actionsDb.markFailed(db, id, err.message);
  throw new ExternalServiceError(err.message);
}
```

If step 2 succeeds but step 3a fails (DB down), the action stays `approved`. The heartbeat detects this and retries the status update.

- **Post-execution:** For certain operations, triggers downstream state changes. E.g., after executing `task.delegate`, calls `taskCore.update` to set `delegated_to`.

#### `reject(db: DB, id: string, reason?: string): Promise<Action>`

Rejects a proposed action.

- **Validation:**
  - Throws `NotFoundError` if action doesn't exist.
  - Throws `ValidationError` if not in `proposed` status.
- **Side effect:** Logs rejection reason for preference learning.

#### `expireStale(db: DB, maxAge: Duration): Promise<Action[]>`

Finds actions in `proposed` status older than `maxAge` and transitions them to `expired`. Returns expired actions. Called by heartbeat.

- **Validation per action:** Checks the action is still in `proposed` status before expiring (avoids race with concurrent approval).

#### `retryStuckApproved(db: DB): Promise<void>`

Finds actions stuck in `approved` status (step 2 succeeded but step 3 failed). Attempts to re-execute the status update to `executed`. Called by heartbeat as a consistency repair.

### State Machine

```
proposed ──→ approved ──→ executed
   │            │
   ├──→ rejected │
   │            └──→ failed
   └──→ expired
```

| Transition | Initiated By |
|---|---|
| `proposed → approved` | User (via approve) |
| `proposed → rejected` | User (via reject) |
| `proposed → expired` | System (heartbeat via expireStale) |
| `approved → executed` | System (automatic after approval) |
| `approved → failed` | System (execution error) |

Read-only operations bypass the state machine — created directly as `executed`.

### Connector Usage

`approve` dispatches to the appropriate connector based on `operation`:

| Operation | Connector Call |
|---|---|
| `email.send` | `EmailClient.sendEmail` |
| `email.draft_reply` | `EmailClient.sendEmail` (draft is the input, send is execution) |
| `email.draft_new` | `EmailClient.sendEmail` |
| `calendar.create_event` | `CalendarClient.createEvent` |
| `calendar.update_event` | `CalendarClient.updateEvent` |
| `calendar.cancel_event` | `CalendarClient.cancelEvent` |
| `doc.create` | `DriveClient.createDocument` |
| `doc.edit` | (future) |
| `doc.share` | (future) |

All connector calls are wrapped: success → `executed`, failure → `failed` with `ExternalServiceError`.

### Heartbeat Logic

- **Expire stale proposals:** `expireStale` transitions old proposed actions to `expired`.
- **Retry stuck approvals:** `retryStuckApproved` detects and repairs actions stuck in `approved` state.

### Cross-Module Calls

- `approve` may call `taskCore.transition` after executing task-related operations (e.g., after `task.complete` action is executed, transition task to `complete`).
- `approve` may call `taskCore.update` after executing `task.delegate` (set `delegated_to`).
- Created by `threadsCore.investigateThread`, `eventsCore.processPostMeeting`, and `taskCore.detectCompletions`.

---

## Operation Dispatch

`actions.approve` needs to map an action's `operation` field to the correct connector call. This is handled by a dispatch function internal to `core/actions.ts`:

```typescript
async function executeExternalOperation(
  action: Action,
  connectors: { email: EmailClient, calendar: CalendarClient, drive: DriveClient }
): Promise<Record<string, unknown>> {
  switch (action.operation) {
    case 'email.send':
    case 'email.draft_reply':
    case 'email.draft_new':
      return connectors.email.sendEmail(action.input as SendEmailParams);

    case 'calendar.create_event':
      return connectors.calendar.createEvent(action.input as CreateEventParams);

    case 'calendar.update_event':
      return connectors.calendar.updateEvent(
        action.input.eventId as string,
        action.input as UpdateEventParams
      );

    case 'calendar.cancel_event':
      await connectors.calendar.cancelEvent(action.input.eventId as string);
      return {};

    case 'doc.create':
      return connectors.drive.createDocument(action.input as CreateDocParams);

    default:
      throw new ValidationError(`Unknown operation: ${action.operation}`);
  }
}
```

Connectors are injected into core functions — not imported directly. This preserves the interface-only dependency.

---

## Chained Operations

Some operations trigger follow-on operations internally, as defined in the [system spec](../requirements/system_spec.md#operations):

- **`calendar.update_event`** → chains `email.send` to notify participants. The notification emails are created as separate proposed actions (unless the user approved "update + notify" as a batch).
- **`calendar.cancel_event`** → chains `email.send` to notify participants. Same pattern.
- **`task.delegate`** → chains `email.send` for handoff email. Created as a proposed action linked to the task.

Chained operations are always new proposed actions — they go through the approval lifecycle independently. The parent action references them via `output.chainedActionIds`.

---

## Transaction Boundary Summary

Reference: [backend_architecture.md](backend_architecture.md#transaction-boundaries).

| Core Function | Transactional | Reason |
|---|---|---|
| `buckets.remove` | Yes | Reassign threads + delete bucket atomically |
| `threads.investigateThread` | Yes | Creates people + tasks + actions atomically |
| `threads.resortAll` | Yes | Partial re-sort is broken state |
| `events.processPostMeeting` | Yes | Updates event + creates tasks + actions atomically |
| `people.reject` | Yes | Status change + soft delete atomically |
| `actions.approve` | Split | External API call can't be inside DB transaction |
| `threads.batchClassifyAndAssign` | No | Each thread independent — partial success valid |
| `threads.sortInbox` | No | Individual thread operations are independent |
| `events.syncFromCalendar` | No | Each event independent |
| `tasks.flagOverdue` | No | Each task independent |
| `actions.expireStale` | No | Each action independent |
| Single entity CRUD | No | Already atomic in Postgres |

---

## Heartbeat Dispatch

The heartbeat cron calls core functions directly. Each step is independent — one failure doesn't block others. The heartbeat is **not transactional** overall.

```typescript
// Heartbeat pseudo-code (runs in cron job)
async function heartbeat(db: DB, connectors: Connectors) {
  // 1. Threads: classify new emails
  await threadsCore.sortInbox(db, connectors.email);

  // 2. Events: sync calendar changes
  await eventsCore.syncFromCalendar(db, connectors.calendar, todayRange());

  // 3. Events: process ended meetings
  const endedEvents = await eventsDb.findEndedUnprocessed(db);
  for (const event of endedEvents) {
    await eventsCore.processPostMeeting(db, event.id, connectors.email, connectors.drive)
      .catch(err => logger.error({ err, eventId: event.id }, 'post-meeting failed'));
  }

  // 4. Tasks: flag overdue
  await tasksCore.flagOverdue(db);

  // 5. Tasks: detect completions
  await tasksCore.detectCompletions(db, connectors.email);

  // 6. Actions: expire stale proposals
  await actionsCore.expireStale(db, { hours: 24 });

  // 7. Actions: retry stuck approvals
  await actionsCore.retryStuckApproved(db);
}
```

Each step logs independently. Failures in one step don't prevent subsequent steps from running.

---

## Connector Injection

Core functions that need external APIs receive connector interfaces as arguments — never import concrete implementations:

```typescript
// core/threads.ts
export async function sortInbox(
  db: DB,
  emailClient: EmailClient   // ← interface from connectors/interfaces.ts
): Promise<{ jobId: string }>

// core/events.ts
export async function prepMeeting(
  db: DB,
  id: string,
  emailClient: EmailClient,
  calendarClient: CalendarClient,
  driveClient: DriveClient
): Promise<{ jobId: string }>
```

Routes and the heartbeat cron inject concrete instances created at app startup (see [backend_architecture.md](backend_architecture.md#connectors)). Tests inject stubs.

---

## Validation Rules Summary

Rules checked by core before proceeding. Violations throw `ValidationError` unless noted.

| Rule | Module | Throws |
|---|---|---|
| Can't re-propose a rejected person | `people.create` | `ConflictError` |
| Can't have duplicate email | `people.create` | `ConflictError` |
| Can't confirm/reject non-proposed person | `people.confirm/reject` | `ValidationError` |
| Can't have duplicate bucket name | `buckets.create/update` | `ConflictError` |
| Can't delete last bucket | `buckets.remove` | `ValidationError` |
| Can't delegate to unconfirmed person | `tasks.create/update` | `ValidationError` |
| Can't update complete/rejected task | `tasks.update` | `ValidationError` |
| Invalid status transition | `tasks.transition` | `ValidationError` |
| Can't approve non-proposed action | `actions.approve` | `ValidationError` |
| Can't approve expired action | `actions.approve` | `ValidationError` |
| Can't reject non-proposed action | `actions.reject` | `ValidationError` |
| Target bucket must exist | `threads.update/classifyAndAssign` | `NotFoundError` |
| Source entity must exist (if set) | `tasks.create` | `NotFoundError` |
