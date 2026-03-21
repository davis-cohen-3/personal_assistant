# Phase 2: Database Layer — Completion Report

## Summary

Phase 2 establishes the full database layer: Drizzle schema for all 8 tables, initial migration with embedded trigger and seed data, connection pooling, and all query functions. After this phase, 11 tests pass against real Postgres, `pnpm run lint`, `pnpm run lint:arch`, and `pnpm run build` all succeed.

---

## Task 2.1: Schema, Connection, and Migrations

### Files Created

| File | Purpose |
|------|---------|
| `src/server/db/schema.ts` | All 8 tables: buckets, bucket_templates, google_tokens, email_threads, email_messages, thread_buckets, conversations, chat_messages |
| `src/server/db/index.ts` | Drizzle client using `pg.Pool`, fail-fast on missing `DATABASE_URL` |
| `src/server/db/migrations/0000_perfect_steve_rogers.sql` | Initial migration with `set_updated_at()` trigger and 3 bucket template seeds embedded |
| `src/server/db/migrations/meta/` | Drizzle-generated journal and snapshot |

### Schema Details

- **buckets** — id (uuid PK), name (unique), description, sort_order, created_at
- **bucket_templates** — id (uuid PK), name (unique), description, buckets (jsonb)
- **google_tokens** — id (text PK, fixed to `"primary"`), encrypted access/refresh tokens, scope, token_type, expiry_date, updated_at
- **email_threads** — id (uuid PK), gmail_thread_id (unique index), subject, snippet, from_email/name, last_message_at, message_count, label_ids (jsonb), gmail_history_id, synced_at
- **email_messages** — id (uuid PK), gmail_message_id (unique index), gmail_thread_id (FK → email_threads.gmail_thread_id), from/to/cc, subject, body_text, received_at, synced_at
- **thread_buckets** — id (uuid PK), gmail_thread_id (unique index, FK → email_threads.gmail_thread_id), bucket_id (FK → buckets.id), subject, snippet, needs_rebucket, assigned_at
- **conversations** — id (uuid PK), title, sdk_session_id, created_at, updated_at (with `set_updated_at()` trigger)
- **chat_messages** — id (uuid PK), conversation_id (FK → conversations.id), role, content, created_at

### Decisions & Deviations

- **Local Postgres over Docker:** Davis uses Homebrew Postgres, not Docker. `DATABASE_URL` is `postgresql://daviscohen@localhost:5432/pa_agent` (no password). `tests/setup.ts` defaults to this so `pnpm test` works without manually setting env.
- **FEAS-004 fix — FK ordering:** Drizzle generated the unique index on `email_threads.gmail_thread_id` *after* the FK constraints that reference it. Manually reordered the migration SQL to create the unique index first.
- **MIN-011 — trigger + seed embedded in `0000` migration:** The `set_updated_at()` trigger and all 3 bucket template seed inserts are appended to the single generated migration file, avoiding numbering collisions.
- **`skipLibCheck: true` in tsconfig.server.json:** drizzle-orm 0.38 ships broken type declarations for mysql/sqlite/singlestore adapters. Added `skipLibCheck` to unblock the server build without affecting runtime correctness.
- **`db/index.ts` fail-fast:** Uses explicit null check (`if (!databaseUrl) throw`) instead of non-null assertion `!` to satisfy biome's `noNonNullAssertion` rule.
- **Migration meta files excluded from biome:** Added `!src/server/db/migrations/**` to biome `includes` to avoid formatter errors on Drizzle-generated JSON.

### Review Issues Addressed

| Issue | Resolution |
|-------|-----------|
| FEAS-004 | FK ordering fixed — unique index on `gmail_thread_id` created before FK constraints reference it |
| MIN-011 | `set_updated_at()` trigger and seed data embedded in initial `0000` migration |
| MIN-008 | `BucketDefinitionSchema` (Zod) validates template JSONB in `applyBucketTemplate` |
| FEAS-005 | `assignThreadsBatch` conflict target is `threadBuckets.gmail_thread_id` (unique column), tested |

---

## Task 2.2: Query Functions + Tests

### Files Created

| File | Purpose |
|------|---------|
| `src/server/db/queries.ts` | All query functions per `03_data_layer.md` Queries Needed section |
| `tests/unit/db/queries.test.ts` | 10 integration tests against real Postgres |
| `tests/setup.ts` | Sets `DATABASE_URL` default for test environment |

### Query Functions Implemented

| Group | Functions |
|-------|-----------|
| Google tokens | `getGoogleTokens`, `upsertGoogleTokens` |
| Bucket templates | `listBucketTemplates`, `getBucketTemplate`, `applyBucketTemplate` (Zod validation + 409 conflict) |
| Buckets | `listBuckets`, `createBucket`, `updateBucket`, `deleteBucket` |
| Email sync | `upsertEmailThread`, `upsertEmailMessages`, `getEmailThread`, `listEmailThreads`, `listEmailThreadsByGmailIds` |
| Thread buckets | `listThreadsByBucket`, `assignThread`, `unassignThread`, `listBucketsWithThreads` |
| Batch bucketing | `getUnbucketedThreads`, `countUnbucketedThreads`, `assignThreadsBatch` (25-row cap) |
| Re-bucketing | `markAllForRebucket`, `getThreadsNeedingRebucket`, `clearRebucketFlag` |
| Conversations | `listConversations`, `getConversation`, `createConversation`, `updateConversation`, `deleteConversation` |
| Chat messages | `listMessagesByConversation`, `createChatMessage` (explicit `updated_at` update in transaction) |

### Test Coverage

| Test | What it verifies |
|------|-----------------|
| `applyBucketTemplate` — creates buckets from template | Template JSONB parsed via Zod, buckets inserted correctly |
| `applyBucketTemplate` — throws 409 when buckets exist | Conflict guard prevents double-apply |
| `createChatMessage` — updates `conversations.updated_at` | Explicit timestamp update in transaction (trigger only fires on direct conversation updates) |
| `createChatMessage` — persists the message | Message stored with correct role, content, conversation_id |
| `assignThreadsBatch` — inserts within batch limit | Batch insert with upsert on conflict |
| `assignThreadsBatch` — throws when exceeding 25 | AppError thrown for oversized batch |
| `upsertEmailThread` — inserts new thread | Basic insert path |
| `upsertEmailThread` — updates on conflict | Conflict on `gmail_thread_id` updates fields |
| `assignThread` — moves thread to new bucket | Upsert changes `bucket_id` on re-assignment |
| `createConversation` — returns conversation with title | Basic insert + return |

### Modified Files

| File | Change |
|------|--------|
| `vitest.config.ts` | Added `setupFiles: ["tests/setup.ts"]` |
| `tsconfig.server.json` | Added `skipLibCheck: true` for drizzle-orm type issues |
| `biome.json` | Excluded `src/server/db/migrations/**` from linting |
| `src/client/main.tsx` | Fixed pre-existing `noNonNullAssertion` lint error |
| `.env.example` | Updated `DATABASE_URL` to local Homebrew format |

---

## Verification Results

| Check | Status |
|-------|--------|
| `pnpm run lint` | Pass (0 warnings) |
| `pnpm run lint:arch` | Pass (all 3 linters) |
| `tsc --noEmit` | Fails on drizzle-orm sqlite/mysql type declarations (not used; `skipLibCheck` in server build handles it) |
| `pnpm run build` | Pass |
| `pnpm test` | Pass — 11 tests (10 queries + 1 placeholder) |
| Migration applies cleanly | Pass — tables, trigger, and seeds all present |

---

## Directory Structure After Phase 2

```
src/server/db/
├── index.ts              # Drizzle client with pg.Pool
├── schema.ts             # All 8 tables
├── queries.ts            # All query functions
└── migrations/
    ├── 0000_perfect_steve_rogers.sql   # Tables + trigger + seeds
    └── meta/
        ├── 0000_snapshot.json
        └── _journal.json

tests/
├── setup.ts              # DATABASE_URL default for tests
└── unit/
    ├── placeholder.test.ts
    └── db/
        └── queries.test.ts   # 10 integration tests
```
