# Data Layer

## Overview

Postgres 16 with Drizzle ORM. Eight tables: `buckets`, `bucket_templates`, `thread_buckets`, `email_threads`, `email_messages`, `google_tokens`, `conversations`, `chat_messages`. Single-user — no `user_id` columns anywhere. This is a load-bearing architectural decision (not an oversight): `google_tokens` uses a singleton PK (`'primary'`), the `OAuth2Client` is a module-level singleton, and no table has a user FK. Adding multi-user support would require schema migration + connector refactoring.

Schema source of truth: `src/server/db/schema.ts`

---

## Drizzle Schema

```typescript
// src/server/db/schema.ts
import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';

// --- Buckets ---
export const buckets = pgTable('buckets', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(), // used by agent for classification
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// --- Bucket Templates ---
// Pre-defined starter bucket sets. User picks one on first launch, then customizes.
export const bucketTemplates = pgTable('bucket_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),           // e.g., "Executive", "Sales", "Engineering"
  description: text('description').notNull(),       // what this template is for
  buckets: jsonb('buckets').notNull(),              // Array<{ name, description, sort_order }>
});

// --- Google Tokens ---
// Single row — stores OAuth tokens for the one app user.
// Persisted in Postgres so tokens survive Cloud Run's ephemeral filesystem.
// Uses a fixed text PK ('primary') so upsert always targets the same row.
export const googleTokens = pgTable('google_tokens', {
  id: text('id').primaryKey().$default(() => 'primary'),
  access_token: text('access_token').notNull(),
  refresh_token: text('refresh_token').notNull(),
  scope: text('scope').notNull(),
  token_type: text('token_type').notNull(),
  // Note: googleapis returns expiry_date as epoch ms (number).
  // Convert with new Date(tokens.expiry_date) before upserting.
  expiry_date: timestamp('expiry_date', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// --- Email Threads (local cache of Gmail threads) ---
// Source of truth for "threads we know about". If a thread isn't here, it's new.
export const emailThreads = pgTable('email_threads', {
  id: uuid('id').defaultRandom().primaryKey(),
  gmail_thread_id: text('gmail_thread_id').notNull(),
  subject: text('subject'),
  snippet: text('snippet'),
  from_email: text('from_email'),             // first message sender
  from_name: text('from_name'),
  last_message_at: timestamp('last_message_at', { withTimezone: true }),
  message_count: integer('message_count').notNull().default(1),
  label_ids: jsonb('label_ids'),              // Gmail labels (INBOX, UNREAD, etc.)
  gmail_history_id: text('gmail_history_id'), // for incremental sync later
  synced_at: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueGmailThread: uniqueIndex('email_threads_gmail_thread_id_idx').on(table.gmail_thread_id),
}));

// --- Email Messages (local cache of Gmail messages) ---
// Individual messages within threads. Used for richer classification context.
export const emailMessages = pgTable('email_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  gmail_message_id: text('gmail_message_id').notNull(),
  gmail_thread_id: text('gmail_thread_id').notNull().references(() => emailThreads.gmail_thread_id, { onDelete: 'cascade' }),
  from_email: text('from_email'),
  from_name: text('from_name'),
  to_emails: jsonb('to_emails'),             // string[]
  cc_emails: jsonb('cc_emails'),             // string[]
  subject: text('subject'),
  body_text: text('body_text'),              // plain text, truncated to 2000 chars
  received_at: timestamp('received_at', { withTimezone: true }).notNull(),
  synced_at: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueGmailMessage: uniqueIndex('email_messages_gmail_message_id_idx').on(table.gmail_message_id),
  threadIdx: index('email_messages_thread_idx').on(table.gmail_thread_id),
}));

// --- Thread Buckets (join table) ---
export const threadBuckets = pgTable('thread_buckets', {
  id: uuid('id').defaultRandom().primaryKey(),
  gmail_thread_id: text('gmail_thread_id').notNull().references(() => emailThreads.gmail_thread_id, { onDelete: 'cascade' }),
  bucket_id: uuid('bucket_id').notNull().references(() => buckets.id, { onDelete: 'cascade' }),
  subject: text('subject'),                    // cached for display without Gmail API call
  snippet: text('snippet'),                    // cached for display
  needs_rebucket: boolean('needs_rebucket').notNull().default(false), // true when threads need re-evaluation (e.g., new bucket created)
  assigned_at: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueThread: uniqueIndex('thread_buckets_gmail_thread_id_idx').on(table.gmail_thread_id),
}));

// --- Conversations ---
// Each conversation maps to one Agent SDK session. Messages are persisted
// in Postgres for durable UI display; the SDK manages its own context internally.
export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  sdk_session_id: text('sdk_session_id'),          // Agent SDK session identifier; null if session lost
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// --- Chat Messages ---
// Durable message log for UI display. SDK manages its own context internally.
export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversation_id: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),                     // 'user' | 'assistant' | 'system'
  content: text('content').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

---

## Field Definitions

### buckets

| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key, auto-generated |
| name | text, unique | Bucket name (e.g., "Urgent", "Follow Up", "FYI") |
| description | text | What belongs here — the agent reads this to classify threads |
| sort_order | integer | Display order in the BucketBoard UI |
| created_at | timestamptz | Auto-set |

### bucket_templates

| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key, auto-generated |
| name | text, unique | Template name (e.g., "Executive", "Sales", "Engineering") |
| description | text | What this template is for |
| buckets | jsonb | Array of `{ name, description, sort_order }` — the bucket definitions to seed |

Seeded via migration. User picks a template on first launch, which creates the actual `buckets` rows. User can then create/edit/delete buckets freely.

#### Seed Data

The seed migration inserts these three templates:

```json
[
  {
    "name": "Executive",
    "description": "For leaders managing cross-functional communication, reports, and strategic decisions",
    "buckets": [
      { "name": "Needs Response", "description": "Threads requiring a reply from me — questions, approvals, or decisions only I can make", "sort_order": 0 },
      { "name": "FYI / Updates", "description": "Status updates, newsletters, and announcements — read but no action needed", "sort_order": 1 },
      { "name": "Delegated", "description": "Threads I've forwarded or assigned to someone else — track but don't act", "sort_order": 2 },
      { "name": "Scheduling", "description": "Meeting requests, calendar changes, and logistics", "sort_order": 3 },
      { "name": "Low Priority", "description": "Non-urgent threads that can wait — internal FYIs, optional reads", "sort_order": 4 }
    ]
  },
  {
    "name": "Sales",
    "description": "For sales professionals managing deals, prospects, and customer relationships",
    "buckets": [
      { "name": "Hot Deals", "description": "Active opportunities with near-term close dates or pending proposals", "sort_order": 0 },
      { "name": "New Leads", "description": "Inbound inquiries, introductions, and first-touch outreach", "sort_order": 1 },
      { "name": "Follow-ups", "description": "Threads where I owe a response or need to check in", "sort_order": 2 },
      { "name": "Internal", "description": "Team updates, CRM notifications, and internal coordination", "sort_order": 3 },
      { "name": "Nurture", "description": "Long-term prospects and relationship maintenance — no immediate action", "sort_order": 4 }
    ]
  },
  {
    "name": "Engineering",
    "description": "For engineers managing code reviews, incidents, and project communication",
    "buckets": [
      { "name": "Review Requested", "description": "PRs, design docs, and RFCs awaiting my review", "sort_order": 0 },
      { "name": "Blocked / Urgent", "description": "Incidents, blockers, and threads that need immediate attention", "sort_order": 1 },
      { "name": "Project Updates", "description": "Sprint updates, standups, and project-level communication", "sort_order": 2 },
      { "name": "CI / Alerts", "description": "Build failures, monitoring alerts, and automated notifications", "sort_order": 3 },
      { "name": "General", "description": "Everything else — team chat, social, non-urgent", "sort_order": 4 }
    ]
  }
]
```

### email_threads

| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key, auto-generated |
| gmail_thread_id | text, unique | Gmail thread ID — source of truth for "known threads" |
| subject | text, nullable | Thread subject line |
| snippet | text, nullable | Gmail snippet preview |
| from_email | text, nullable | First message sender email |
| from_name | text, nullable | First message sender display name |
| last_message_at | timestamptz, nullable | Timestamp of most recent message in thread |
| message_count | integer | Number of messages in thread |
| label_ids | jsonb, nullable | Gmail label IDs (INBOX, UNREAD, SENT, etc.) |
| gmail_history_id | text, nullable | Gmail history ID for incremental sync (v2) |
| synced_at | timestamptz | When this thread was last synced from Gmail |

### email_messages

| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key, auto-generated |
| gmail_message_id | text, unique | Gmail message ID |
| gmail_thread_id | text | Gmail thread ID (groups messages into threads) |
| from_email | text, nullable | Sender email |
| from_name | text, nullable | Sender display name |
| to_emails | jsonb, nullable | Recipient emails (string[]) |
| cc_emails | jsonb, nullable | CC emails (string[]) |
| subject | text, nullable | Message subject |
| body_text | text, nullable | Plain text body, truncated to 2000 chars. Used for classification — not full archival. |
| received_at | timestamptz | When the message was received |
| synced_at | timestamptz | When this message was last synced from Gmail |

### thread_buckets

| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key, auto-generated |
| gmail_thread_id | text, unique | Gmail thread ID — one bucket per thread |
| bucket_id | uuid, FK | References buckets.id, cascades on delete |
| subject | text, nullable | Cached thread subject for display |
| snippet | text, nullable | Cached thread snippet for display |
| needs_rebucket | boolean | Default false. Set to true when all threads need re-evaluation (e.g., new bucket created). Cleared after agent re-classifies. |
| assigned_at | timestamptz | When the thread was assigned to this bucket |

---

### google_tokens

| Field | Type | Description |
|---|---|---|
| id | text | Primary key, always `'primary'` (singleton row) |
| access_token | text | Google OAuth access token |
| refresh_token | text | Google OAuth refresh token (only issued on first consent) |
| scope | text | Granted OAuth scopes |
| token_type | text | Token type (typically "Bearer") |
| expiry_date | timestamptz | When the access token expires |
| updated_at | timestamptz | Last time tokens were refreshed/persisted |

Single row. `auth.ts` upserts on the fixed `id = 'primary'` key on every token refresh.

### conversations

| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key, auto-generated |
| title | text | Display title, auto-generated from first user message |
| sdk_session_id | text, nullable | Agent SDK session ID for resume. Null when session is lost (redeploy/scale-to-zero) |
| created_at | timestamptz | Auto-set |
| updated_at | timestamptz | Auto-set, updated on new message |

### chat_messages

| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key, auto-generated |
| conversation_id | uuid, FK | References conversations.id, cascades on delete |
| role | text | `user`, `assistant`, or `system` |
| content | text | Full message text |
| created_at | timestamptz | Auto-set |

---

## Queries Needed

```typescript
// src/server/db/queries.ts

// --- Google Tokens ---
getGoogleTokens()                       // read the single row (null if not yet authenticated)
upsertGoogleTokens(tokens)             // insert or update the single token row

// --- Bucket Templates ---
listBucketTemplates()                  // all available templates
getBucketTemplate(id)                  // single template with its bucket definitions
applyBucketTemplate(id)               // creates buckets rows from template's jsonb array
                                      // Throws AppError(409) if any buckets already exist — templates are first-launch only.
                                      // To switch templates, user must delete all buckets first.

// --- Buckets ---
listBuckets()                          // ORDER BY sort_order
createBucket(name, description)        // returns created bucket
updateBucket(id, { name?, description?, sort_order? })
deleteBucket(id)                       // cascades thread_buckets

// --- Email Sync ---
upsertEmailThread(threadData)                    // insert or update thread metadata from Gmail
upsertEmailMessages(messages[])                  // bulk insert/update messages for a thread; body_text truncated to 2000 chars
getEmailThread(gmailThreadId)                    // single thread with its messages
listEmailThreads(filters?)                       // paginated, filterable
listEmailThreadsByGmailIds(gmailIds[])           // bulk lookup by Gmail thread IDs — used by email.ts for diff-based sync

// --- Thread Buckets ---
listThreadsByBucket(bucketId)          // all threads in a bucket
assignThread(gmailThreadId, bucketId, subject?, snippet?)  // upsert — moves thread if already assigned
unassignThread(gmailThreadId)
listBucketsWithThreads()              // join query for BucketBoard UI — all buckets with their threads

// --- Batch Bucketing ---
getUnbucketedThreads(limit)           // threads in email_threads NOT in thread_buckets, with messages
                                      // limit capped at BATCH_SIZE (25)
countUnbucketedThreads()              // count of unbucketed threads (for progress reporting)
assignThreadsBatch(assignments[])     // bulk upsert into thread_buckets; capped at BATCH_SIZE; single transaction

// --- Re-bucketing ---
markAllForRebucket()                  // SET needs_rebucket = true on all thread_buckets rows
getThreadsNeedingRebucket(limit)      // thread_buckets WHERE needs_rebucket = true, joined with email_threads for cached content
clearRebucketFlag(gmailThreadIds[])   // SET needs_rebucket = false for given threads

// --- Conversations ---
listConversations()                        // ORDER BY updated_at DESC
getConversation(id)                        // single conversation
createConversation(title)                  // returns created conversation
updateConversation(id, { title?, sdk_session_id? })
deleteConversation(id)                     // cascades chat_messages

// --- Chat Messages ---
listMessagesByConversation(conversationId) // ORDER BY created_at ASC
createChatMessage(conversationId, role, content) // Implementation note: requires two statements in a single transaction:
                                                 // 1. INSERT into chat_messages
                                                 // 2. UPDATE conversations SET updated_at = NOW() WHERE id = conversationId
                                                 // The set_updated_at trigger fires on conversations UPDATE, not transitively on chat_messages INSERT.
```

---

## Migration Setup

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './src/server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

Generate and run migrations:

```bash
# Generate migration from schema changes
pnpm drizzle-kit generate

# Apply migrations
pnpm drizzle-kit migrate
```

### updated_at Trigger

Drizzle doesn't manage triggers natively. Add a custom SQL migration for the `updated_at` auto-update on the `conversations` table:

```sql
-- src/server/db/migrations/0001_updated_at_trigger.sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## Database Connection

```typescript
// src/server/db/index.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
export const db = drizzle(pool, { schema });
```

Pool size defaults to 10, sufficient for single-user. Without a pool, concurrent queries from `pLimit` operations serialize on one connection.
