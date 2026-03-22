# Session: Compound Unique Indexes & Tenant Isolation Tests

**Date:** 2026-03-22
**Phase:** Multi-tenancy

## Summary

Evaluated the multi-tenancy design (explicit userId parameter threading) and concluded it's the right approach for this project's scale. Implemented two hardening measures: (1) compound unique indexes to prevent cross-user collisions in email data tables, and (2) integration tests that verify tenant isolation across all query functions.

## Key Decisions

- Kept the explicit `userId` threading pattern — alternatives (AsyncLocalStorage, scoped repositories, Postgres RLS) add complexity without proportional benefit at this scale
- Added `user_id` to `email_messages` and `thread_buckets` tables to enable compound unique constraints — this required composite foreign keys back to `email_threads`
- Simplified `unassignThread` and `markAllForRebucket` to filter directly on `thread_buckets.user_id` instead of subquerying through related tables
- Set `fileParallelism: false` in vitest config since integration test files share a database and their `cleanDatabase()` calls were interfering

## Code Changes

- Modified: `src/server/db/schema.ts` — compound unique indexes on `email_threads`, `email_messages`, `thread_buckets`; added `user_id` column + composite FKs to `email_messages` and `thread_buckets`
- Modified: `src/server/db/queries.ts` — updated all conflict targets to compound, `upsertEmailMessages` now takes `userId` param, simplified `unassignThread`/`markAllForRebucket`
- Modified: `src/server/email.ts` — pass `userId` to all `upsertEmailMessages` calls
- Modified: `tests/unit/email.test.ts` — mock assertions updated for new `upsertEmailMessages(userId, messages)` signature
- Modified: `vitest.config.ts` — `fileParallelism: false`
- Created: `src/server/db/migrations/0002_compound_unique_indexes.sql` — adds columns, backfills, swaps indexes/FKs
- Created: `tests/integration/db/tenant-isolation.test.ts` — 20 tests covering bucket, email thread, thread assignment, unbucketed, and conversation isolation
- Modified: `src/server/db/migrations/meta/_journal.json` — registered migration 0002

## Migration Notes

- Migration 0002 was manually applied to both `pa_agent` and `pa_agent_test` databases
- The Drizzle migration journal (`drizzle.__drizzle_migrations`) was manually updated in both databases to record the hash
- Migration order matters: old FKs must be dropped before the single-column unique index on `email_threads.gmail_thread_id` can be dropped (dependent objects)

## Test Results

242 tests passing (222 existing + 20 new tenant isolation tests)

## Next Steps

- [ ] Commit all multi-tenancy changes (sessions 001 + 002)
- [ ] Deploy migration to Railway (apply 0001 + 0002 in sequence)
- [ ] Verify production OAuth flow works with the new per-call OAuth2Client
