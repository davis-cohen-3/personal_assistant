# Session: Security Review & Multi-Tenancy Fixes

**Date:** 2026-03-22
**Phase:** Multi-tenancy

## Summary

Reviewed the full uncommitted multi-tenancy diff (~3K lines). Identified 10 issues across security, logic, and clarity. Fixed the critical OAuth2Client race condition, four query ownership gaps, and a null-spread route bug. Re-classified 284 orphaned email threads into buckets after migration data loss.

## Key Decisions

- **OAuth2Client per-call instead of singleton:** `withUserTokens` now creates and returns a new OAuth2Client per call, preventing credential cross-contamination between concurrent users. The singleton `getAuthClient()` remains only for the OAuth login flow (generating auth URLs, exchanging codes).
- **Auth client threaded as first param:** All Google connector functions (gmail, calendar, drive) now take `auth: OAuth2Client` as their first parameter instead of internally calling `getAuthClient()`. Callers get the client from `withUserTokens` and pass it through.
- **Query ownership via joins/subqueries:** Rather than trusting that resource IDs belong to the requesting user, `assignThread`, `assignThreadsBatch`, `unassignThread`, and `listThreadsByBucket` now verify ownership through joins to the buckets/email_threads tables.
- **email_threads unique constraint left as-is:** The compound unique index `(user_id, gmail_thread_id)` was considered but deferred — changing it would break FK references from `email_messages` and `thread_buckets`. The `users.email` unique constraint prevents the collision case in practice (two users can't connect the same Google account).
- **Backfill migration handled manually:** Rather than adding application code for the `backfill@localhost` user reassignment, the data was already on the real user (fresh deploy). Lost bucket assignments were re-classified directly in Postgres.

## Code Changes

- Modified: `src/server/google/auth.ts` — `withUserTokens` returns new OAuth2Client, removed `loadedUserId` singleton, exported `OAuth2Client` type
- Modified: `src/server/google/gmail.ts` — all functions take `auth: OAuth2Client` as first param
- Modified: `src/server/google/calendar.ts` — all functions take `auth: OAuth2Client` as first param
- Modified: `src/server/google/drive.ts` — all functions take `auth: OAuth2Client` as first param
- Modified: `src/server/google/index.ts` — export `OAuth2Client` type
- Modified: `src/server/email.ts` — stores auth client from `withUserTokens`, passes to gmail calls
- Modified: `src/server/routes.ts` — passes auth to calendar calls, added 404 check on GET /conversations/:id
- Modified: `src/server/tools.ts` — passes auth to calendar/drive calls
- Modified: `src/server/db/queries.ts` — ownership checks on `listThreadsByBucket`, `assignThread`, `assignThreadsBatch`, `unassignThread`
- Modified: `tests/unit/google/gmail.test.ts` — auth as first param on all calls
- Modified: `tests/unit/google/calendar.test.ts` — auth as first param on all calls
- Modified: `tests/unit/google/drive.test.ts` — auth as first param on all calls
- Modified: `tests/unit/email.test.ts` — hoisted mock auth client, updated assertions
- Modified: `tests/unit/routes.test.ts` — hoisted mock auth client, updated calendar assertions
- Modified: `tests/unit/tools.test.ts` — hoisted mock auth client, restored mock in beforeEach, updated assertions

## Open Questions

- The `as string` casts on `c.get("userId")` throughout routes.ts/agent.ts are unnecessary given the `AppEnv` type but harmless — cosmetic cleanup deferred

## Next Steps

- [ ] Commit the multi-tenancy changes (all tests pass, build clean)
- [ ] Consider whether the FK refactor (email_threads/email_messages referencing UUID PK instead of gmail_thread_id) is worth doing as a separate PR
