# Database Schema

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| UUID generation | `gen_random_uuid()` column defaults | Built into Postgres 13+, no extension needed. Application can pass UUIDs when needed (e.g., optimistic UI). |
| Timestamps | `timestamptz` everywhere, `date` for `tasks.due_date` | Always store points in time with timezone. `created_at` defaults to `now()`. `updated_at` via Postgres trigger. |
| JSONB validation | Zod only (application layer) | Single-user, single-writer app. Zod schemas in `shared/` are the source of truth. DB-level JSONB constraints are brittle and painful to migrate. |
| Enums | Text + CHECK constraint | Fully transactional migrations. Adding/removing values is a single `ALTER TABLE`. Postgres `CREATE TYPE` enums can't add values inside transactions. |
| Soft deletes | People only (`deleted_at`) | Prevents agent from re-proposing rejected contacts. All other entities use hard delete. Actions are never deleted (audit trail). |
| No user_id | Deliberate — single-user deployment | Each instance is one person's assistant. No multi-tenancy column, no user FK. This is a deployment architecture decision, not an oversight. Adding multi-tenancy later means adding `user_id` FK to every table + RLS policies — a known migration if the product ever needs it. |
| Timestamps pattern | Postgres `DEFAULT now()` + trigger for `updated_at` | Drizzle's `.$defaultFn(() => new Date())` runs in the application. Postgres defaults are more reliable — they work regardless of how the row is inserted (migrations, manual fixes, seed scripts). |
| Briefings as stored records | Lightweight record with JSONB content | The system spec says briefings are "rendered views assembled from live entity state." We store the rendered output for history/audit — the content JSONB is a snapshot, not a source of truth. Re-rendering always queries live data. |

---

## Drizzle Schema

Source of truth: `packages/backend/src/db/schema.ts`

Types re-exported from `packages/shared/` as `$inferSelect` / `$inferInsert` — type-only, no Drizzle runtime in shared. See [Backend Architecture](backend_architecture.md) § Query Return Types.

### Trigger Function

Applied to all tables with `updated_at`. Created in the first migration before any table definitions:

```sql
CREATE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Each table with `updated_at` gets:

```sql
CREATE TRIGGER trg_<table>_updated_at
  BEFORE UPDATE ON <table>
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Drizzle doesn't manage triggers natively — these go in a custom SQL migration alongside the initial `drizzle-kit generate` output.

---

### buckets

```typescript
import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const buckets = pgTable('buckets', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  sortOrder: integer('sort_order').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

No `updated_at` — buckets are simple enough that rename = update name, reorder = update sort_order, neither needs audit.

**Seed data** (see [Seed Data](#seed-data) section).

---

### people

```typescript
export const people = pgTable('people', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role'),
  company: text('company'),
  relationshipType: text('relationship_type', {
    enum: ['colleague', 'client', 'vendor', 'reports_to_me', 'i_report_to', 'external', 'personal', 'other'],
  }).notNull(),
  context: text('context'),
  notes: text('notes'),
  lastInteraction: timestamp('last_interaction', { withTimezone: true }),
  status: text('status', {
    enum: ['proposed', 'confirmed', 'rejected'],
  }).notNull().default('proposed'),
  source: text('source', {
    enum: ['inbox_scan', 'calendar_event', 'user_created'],
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
```

**Trigger:** `set_updated_at()` BEFORE UPDATE.

**Soft delete:** Default queries exclude `deleted_at IS NOT NULL`. Explicit `IncludeDeleted` variant for re-proposal prevention. See [Backend Architecture](backend_architecture.md) § Soft Delete.

---

### threads

```typescript
export const threads = pgTable('threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  gmailThreadId: text('gmail_thread_id').notNull().unique(),
  subject: text('subject'),
  snippet: text('snippet'),
  bucketId: uuid('bucket_id').notNull().references(() => buckets.id, { onDelete: 'restrict' }),
  classification: jsonb('classification').notNull().default({}),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Trigger:** `set_updated_at()` BEFORE UPDATE.

**FK behavior:** `bucket_id` ON DELETE RESTRICT — must re-sort threads out of a bucket before deleting it (handled in `services/buckets.ts` within a transaction, per [Backend Architecture](backend_architecture.md) § Transaction Boundaries).

**`classification` JSONB shape** (Zod schema in `shared/schemas/thread.ts`):

```typescript
import { z } from 'zod';

export const ThreadClassificationSchema = z.object({
  urgency: z.enum(['critical', 'high', 'normal', 'low']),
  action_needed: z.boolean(),
  awaiting_response: z.boolean(),
  category: z.string(),
  confidence: z.number().min(0).max(1),
});

export type ThreadClassification = z.infer<typeof ThreadClassificationSchema>;
```

`awaiting_response` tracks "waiting on" state orthogonally to buckets — any thread in any bucket can be awaiting a response.

`confidence` supports the Buffer bucket — threads below a threshold are automatically assigned to Buffer.

---

### events

```typescript
export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleEventId: text('google_event_id').notNull().unique(),
  title: text('title'),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }).notNull(),
  eventType: text('event_type', {
    enum: ['one_on_one', 'group', 'external', 'recurring', 'focus_time', 'other'],
  }).notNull(),
  participantIds: jsonb('participant_ids').notNull().default([]),  // People UUIDs — if person is soft-deleted, resolve from Google Calendar event
  relatedThreadIds: jsonb('related_thread_ids').notNull().default([]),
  documents: jsonb('documents').notNull().default([]),
  brief: jsonb('brief'),
  preMetadata: jsonb('pre_metadata'),
  postMetadata: jsonb('post_metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Trigger:** `set_updated_at()` BEFORE UPDATE.

**JSONB shapes** (Zod schemas in `shared/schemas/event.ts`):

```typescript
import { z } from 'zod';

export const DocumentRefSchema = z.object({
  google_doc_id: z.string(),
  title: z.string(),
  url: z.string().url(),
});

export const EventBriefSchema = z.object({
  summary: z.string(),
  related_threads: z.array(z.object({
    thread_id: z.string().uuid(),
    subject: z.string(),
    relevance: z.string(),
  })),
  related_docs: z.array(z.object({
    google_doc_id: z.string(),
    title: z.string(),
    relevance: z.string(),
  })),
  participant_notes: z.array(z.object({
    person_id: z.string().uuid(),
    name: z.string(),
    context: z.string(),
  })),
});

export const PreMetadataSchema = z.object({
  participant_count: z.number().int(),
  event_type_classification: z.string(),
  agenda_exists: z.boolean(),
});

export const PostMetadataSchema = z.object({
  actual_duration: z.number(),           // minutes
  action_items_produced: z.number().int(),
  follow_up_threads: z.array(z.string().uuid()),
  notes_link: z.string().url().nullable(),
  agenda_covered: z.boolean().nullable(),
});

export type DocumentRef = z.infer<typeof DocumentRefSchema>;
export type EventBrief = z.infer<typeof EventBriefSchema>;
export type PreMetadata = z.infer<typeof PreMetadataSchema>;
export type PostMetadata = z.infer<typeof PostMetadataSchema>;
```

---

### tasks

```typescript
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status', {
    enum: ['proposed', 'confirmed', 'rejected', 'in_progress', 'complete_proposed', 'complete', 'overdue'],
  }).notNull().default('proposed'),
  priority: text('priority', {
    enum: ['urgent', 'high', 'normal', 'low'],
  }).notNull().default('normal'),
  dueDate: date('due_date', { mode: 'string' }),
  delegatedTo: uuid('delegated_to').references(() => people.id, { onDelete: 'set null' }),
  sourceType: text('source_type', {
    enum: ['thread', 'event', 'user', 'agent'],
  }),
  sourceId: uuid('source_id'),
  relatedDocuments: jsonb('related_documents').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Trigger:** `set_updated_at()` BEFORE UPDATE.

**FK behavior:** `delegated_to` ON DELETE SET NULL — if a person is soft-deleted, the task remains but delegation is cleared.

**`source_id` is not a formal FK** — it references different tables depending on `source_type`. Application layer resolves the polymorphic reference.

**`related_documents` JSONB shape:** `DocumentRef[]` (same schema as events).

**Task status flow:**

```
proposed → confirmed → in_progress → complete_proposed → complete
                                    ↘ overdue
          ↘ rejected
```

---

### actions

```typescript
export const actions = pgTable('actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  operation: text('operation').notNull(),
  initiatedBy: text('initiated_by', {
    enum: ['agent', 'user'],
  }).notNull(),
  status: text('status', {
    enum: ['proposed', 'approved', 'executed', 'rejected', 'expired', 'failed'],
  }).notNull().default('proposed'),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  input: jsonb('input').notNull().default({}),
  output: jsonb('output'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  executedAt: timestamp('executed_at', { withTimezone: true }),
});
```

No `updated_at` — actions transition through statuses via explicit updates, and `executed_at` captures the meaningful timestamp.

Never deleted — this is the audit trail.

**`entity_id` is not a formal FK** — actions reference multiple entity types and must survive even if the referenced entity is deleted.

**Action status flow:**

```
proposed → approved → executed
          ↘ rejected
          ↘ expired
                     ↘ failed (from approved, on execution error)
```

**`input` / `output` JSONB shapes** — operation-specific. Validated by per-operation Zod schemas in `shared/schemas/action.ts`:

```typescript
import { z } from 'zod';

// Each operation defines its own input/output shape.
// Discriminated union keyed by operation name.

export const EmailSendInputSchema = z.object({
  to: z.array(z.string().email()),
  cc: z.array(z.string().email()).optional(),
  subject: z.string(),
  body: z.string(),
  thread_id: z.string().optional(),  // reply vs new
});

export const EmailSendOutputSchema = z.object({
  message_id: z.string(),
  thread_id: z.string(),
});

export const ThreadClassifyInputSchema = z.object({
  thread_id: z.string().uuid(),
  bucket_id: z.string().uuid(),
  classification: z.object({
    urgency: z.enum(['critical', 'high', 'normal', 'low']),
    action_needed: z.boolean(),
    category: z.string(),
  }),
});

// ... additional operation schemas follow the same pattern
```

---

### briefings

```typescript
export const briefings = pgTable('briefings', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date', { mode: 'string' }).notNull().unique(),
  content: jsonb('content').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

No `updated_at` — briefings are immutable snapshots. If the user presses "Start Day" again, a new briefing replaces the old one for that date (upsert on `date`).

**`content` JSONB shape** (Zod schema in `shared/schemas/briefing.ts`):

```typescript
import { z } from 'zod';

export const BriefingContentSchema = z.object({
  priority_actions: z.array(z.object({
    action_id: z.string().uuid(),
    summary: z.string(),
    operation: z.string(),
  })),
  meetings: z.array(z.object({
    event_id: z.string().uuid(),
    title: z.string(),
    start_time: z.string().datetime(),
    brief_summary: z.string(),
  })),
  tasks_due: z.array(z.object({
    task_id: z.string().uuid(),
    title: z.string(),
    due_date: z.string(),
    status: z.string(),
  })),
  overdue_tasks: z.array(z.object({
    task_id: z.string().uuid(),
    title: z.string(),
    due_date: z.string(),
  })),
  delegations: z.array(z.object({
    task_id: z.string().uuid(),
    title: z.string(),
    delegated_to_name: z.string(),
    status: z.string(),
  })),
  follow_ups: z.array(z.object({
    thread_id: z.string().uuid().optional(),
    task_id: z.string().uuid().optional(),
    summary: z.string(),
  })),
});

export type BriefingContent = z.infer<typeof BriefingContentSchema>;
```

This is a **snapshot** for history — the IDs inside reference live entities, but the summary strings are frozen at generation time. The frontend re-renders from live entity state for the current briefing; stored briefings are for "what did I see this morning?" recall.

---

## Indexes

### Unique Indexes (from column constraints)

Created automatically by Drizzle from `.unique()`:

| Table | Column | Query it supports |
|---|---|---|
| `buckets` | `name` | Bucket lookup by name, prevent duplicates |
| `people` | `email` | Contact lookup by email, prevent duplicates |
| `threads` | `gmail_thread_id` | Upsert on inbox sync — find-or-create by Gmail ID |
| `events` | `google_event_id` | Upsert on calendar sync — find-or-create by Google ID |
| `briefings` | `date` | One briefing per day, upsert on "Start Day" |

### GIN Indexes

```typescript
// In schema.ts or a separate indexes file
import { index } from 'drizzle-orm/pg-core';

// "Find all events where person X is a participant"
// Used by: Prep Meeting (cross-reference participants), interaction history
export const eventsParticipantIdsIdx = index('events_participant_ids_idx')
  .on(events.participantIds)
  .using('gin');
```

Only `participant_ids` gets a GIN index. `related_thread_ids`, `documents`, and other JSONB columns are not queried with containment operators — they're read as whole values when the parent row is already fetched.

### B-tree Indexes

```typescript
// Threads by bucket — "Show all threads in this bucket"
// Used by: Inbox view, Re-sort Inbox
export const threadsBucketIdIdx = index('threads_bucket_id_idx')
  .on(threads.bucketId);

// Threads by recency — "Most recent threads first"
// Used by: Inbox view, Sort Inbox (find recent threads)
export const threadsLastMessageAtIdx = index('threads_last_message_at_idx')
  .on(threads.lastMessageAt);

// Events by start time — "Today's events", "Upcoming events"
// Used by: Daily Briefing, Prep Meeting, Heartbeat (detect ended meetings)
export const eventsStartTimeIdx = index('events_start_time_idx')
  .on(events.startTime);

// Tasks by status — "All in-progress tasks", "All proposed tasks"
// Used by: Daily Briefing (tasks due/overdue), Heartbeat (status checks)
export const tasksStatusIdx = index('tasks_status_idx')
  .on(tasks.status);

// Tasks by due date — "Tasks due today", "Overdue tasks"
// Used by: Daily Briefing, Heartbeat (overdue detection)
export const tasksDueDateIdx = index('tasks_due_date_idx')
  .on(tasks.dueDate);

// Delegated tasks — "All tasks delegated to someone"
// Partial index: only rows where delegated_to is set
// Used by: Delegation status in briefing, stale delegation detection
export const tasksDelegatedToIdx = index('tasks_delegated_to_idx')
  .on(tasks.delegatedTo)
  .where(sql`delegated_to IS NOT NULL`);

// Actions by status — "All pending actions" for action cards
// Used by: UI action card queue, approval workflow
export const actionsStatusIdx = index('actions_status_idx')
  .on(actions.status);

// Actions by entity — "All actions related to this thread/person/task"
// Used by: Entity detail views, audit trail per entity
export const actionsEntityIdx = index('actions_entity_type_entity_id_idx')
  .on(actions.entityType, actions.entityId);

// Proposed actions by operation and entity — "Is there already a proposed reply for this thread?"
// Partial index: only proposed actions (small subset of all actions)
// Used by: Deduplication — agent checks before proposing a duplicate action
export const actionsProposedIdx = index('actions_proposed_idx')
  .on(actions.operation, actions.entityType, actions.entityId)
  .where(sql`status = 'proposed'`);

// People by status — "All proposed contacts" for review
// Used by: People review queue, confirmed contacts list
export const peopleStatusIdx = index('people_status_idx')
  .on(people.status);
```

### Index Summary

| Index | Type | Rationale |
|---|---|---|
| `events_participant_ids_idx` | GIN | JSONB containment queries for participant lookups |
| `threads_bucket_id_idx` | B-tree | Filter threads by bucket (inbox view) |
| `threads_last_message_at_idx` | B-tree | Sort threads by recency |
| `events_start_time_idx` | B-tree | Date range queries for calendar views |
| `tasks_status_idx` | B-tree | Filter by status (proposed, in_progress, overdue) |
| `tasks_due_date_idx` | B-tree | Due date range queries, overdue detection |
| `tasks_delegated_to_idx` | B-tree (partial) | Delegated task lookups — only indexes non-null rows |
| `actions_status_idx` | B-tree | Pending action card queue |
| `actions_entity_type_entity_id_idx` | B-tree (composite) | Per-entity audit trail |
| `actions_proposed_idx` | B-tree (partial, composite) | Duplicate proposal prevention — only indexes `status = 'proposed'` |
| `people_status_idx` | B-tree | Contact review queue by status |

---

## FK Behavior

| FK | ON DELETE | Rationale |
|---|---|---|
| `threads.bucket_id` → `buckets.id` | RESTRICT | Must re-sort threads before deleting a bucket (transactional, per [Backend Architecture](backend_architecture.md) § Transaction Boundaries) |
| `tasks.delegated_to` → `people.id` | SET NULL | If person is soft-deleted, task remains but delegation is cleared |

Intentionally not FKs:
- `tasks.source_id` — polymorphic reference, resolved at application layer
- `actions.entity_id` — references multiple entity types, must survive entity deletion (audit trail)
- JSONB arrays (`participant_ids`, `related_thread_ids`) — referential integrity checked at application layer when the data is written

---

## Soft Delete

Only on the `people` table. Documented rationale:

- **People** — the agent discovers contacts and proposes them. Users can reject. Without soft delete, the agent would re-discover and re-propose the same person on the next inbox scan. `deleted_at` + `findByEmailIncludeDeleted()` prevents this. See [Backend Architecture](backend_architecture.md) § Soft Delete for the query pattern.
- **Threads** — represent Gmail state. If a thread disappears from Gmail, we hard delete the local reference. No re-proposal risk.
- **Events** — same as threads. Represent Google Calendar state.
- **Tasks** — rejected tasks have `status: rejected`. No soft delete needed — status already encodes the rejection.
- **Actions** — never deleted. They're the audit trail.
- **Buckets** — user-managed. Deletion is intentional and requires thread re-sort first.
- **Briefings** — immutable snapshots. Delete old ones via a retention policy if needed; no soft delete semantics.

---

## Seed Data

`packages/backend/src/db/seed.sql` — run via `pnpm db:seed` after migrations. Idempotent.

```sql
INSERT INTO buckets (name, description, sort_order) VALUES
  ('Needs Founder', 'Requires the user''s unique authority: approvals, strategic decisions, high-stakes client issues, hiring/firing.', 1),
  ('External', 'Active conversations with clients, leads, partners, investors. Direct business impact.', 2),
  ('Internal', 'Team, contractors, vendors. Project updates, internal blockers, delegation follow-ups.', 3),
  ('Admin', 'Receipts, invoices, travel, subscriptions, bank alerts. Operational housekeeping.', 4),
  ('FYI', 'Newsletters, CC-only threads, announcements. No action needed.', 5),
  ('Buffer', 'Agent isn''t confident in classification. Surfaces for user to sort — learns from the correction.', 6)
ON CONFLICT (name) DO NOTHING;
```

---

## Migration Strategy

### Tooling

`drizzle-kit` for all schema migrations. Two commands:

| Command | What it does | When to use |
|---|---|---|
| `drizzle-kit generate` | Diffs `schema.ts` against the current migration history, produces a new `.sql` migration file | After any schema change |
| `drizzle-kit migrate` | Runs all pending migration files against the database, in order | Deploy time (dev and production) |
| `drizzle-kit push` | Pushes schema directly to database without generating a migration file | **Never in production.** Acceptable for rapid local prototyping only. |

### Dev Workflow

```bash
# 1. Edit schema.ts
# 2. Generate migration
pnpm drizzle-kit generate

# 3. Review the generated SQL in drizzle/ directory
# 4. Apply to local database
pnpm drizzle-kit migrate

# 5. Seed (if first run or seed data changed)
pnpm db:seed
```

The `drizzle-kit generate` step produces sequential `.sql` files in `packages/backend/drizzle/`. Single developer, so no branch migration conflicts.

### Production Workflow

```bash
# On deploy:
pnpm drizzle-kit migrate   # runs pending migrations
pnpm db:seed                # idempotent seed
```

Migrations run before the app starts. If a migration fails, the deploy fails — no partial schema state.

### Custom SQL

Drizzle doesn't manage triggers, functions, or custom indexes with `WHERE` clauses natively. These go in the generated migration files as manual SQL additions:

1. `drizzle-kit generate` creates the migration
2. Edit the generated `.sql` file to add `CREATE FUNCTION set_updated_at()`, `CREATE TRIGGER`, and partial indexes
3. Commit the modified migration

This only applies to the initial migration. Subsequent migrations are pure Drizzle-generated DDL unless new triggers or custom SQL are needed.

### drizzle.config.ts

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

---

## Type Re-export Pattern

Schema defines types. `shared/` re-exports them for frontend consumption. No Drizzle runtime in `shared/`.

```typescript
// packages/backend/src/db/schema.ts (source of truth — shown above)

// packages/shared/src/types/index.ts (type-only re-exports)
import type { people, threads, buckets, events, tasks, actions, briefings } from '@assistant/backend/db/schema';

export type Person = typeof people.$inferSelect;
export type PersonInsert = typeof people.$inferInsert;

export type Thread = typeof threads.$inferSelect;
export type ThreadInsert = typeof threads.$inferInsert;

export type Bucket = typeof buckets.$inferSelect;
export type BucketInsert = typeof buckets.$inferInsert;

export type Event = typeof events.$inferSelect;
export type EventInsert = typeof events.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type TaskInsert = typeof tasks.$inferInsert;

export type Action = typeof actions.$inferSelect;
export type ActionInsert = typeof actions.$inferInsert;

export type Briefing = typeof briefings.$inferSelect;
export type BriefingInsert = typeof briefings.$inferInsert;
```

Zod schemas for JSONB columns also live in `shared/schemas/` — used by both backend (validation on write) and frontend (type inference for rendering).

---

## Cross-References

- **Connection management** (`db/client.ts`, pool size, `DB` type) — [Backend Architecture](backend_architecture.md) § Connection Management
- **Transaction boundaries** (`db | tx` pattern, which operations are transactional) — [Backend Architecture](backend_architecture.md) § Transactions
- **Soft delete query pattern** (`findByEmail` vs `findByEmailIncludeDeleted`) — [Backend Architecture](backend_architecture.md) § Soft Delete
- **Query return types** (`$inferSelect` / `$inferInsert` re-export) — [Backend Architecture](backend_architecture.md) § Query Return Types
- **Entity definitions and status flows** — [System Spec](../requirements/system_spec.md) § Entities
- **JSONB + GIN decision rationale** — [Tech Stack](tech_stack.md) § Database
