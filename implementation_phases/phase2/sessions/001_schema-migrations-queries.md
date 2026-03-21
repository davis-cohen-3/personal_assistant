# Session: Schema, Migrations, and Queries

**Date:** 2026-03-21
**Phase:** 2 — Database Layer

## Summary

Implemented the full database layer (Tasks 2.1 and 2.2). All 8 tables are defined in Drizzle schema, the initial migration is applied, bucket templates are seeded, and all query functions are implemented with TDD. 11 tests pass against real Postgres, lint is clean, and the build succeeds.

## Key Decisions

- **Local Postgres over Docker:** Davis uses Homebrew Postgres, not Docker. DATABASE_URL is `postgresql://daviscohen@localhost:5432/pa_agent` (no password). `tests/setup.ts` defaults to this so `pnpm test` works without manually setting env.
- **FEAS-004 fix — FK ordering:** Drizzle generated the unique index on `email_threads.gmail_thread_id` *after* the FK constraints that reference it. Manually reordered the migration SQL to create the unique index first.
- **MIN-011 — trigger + seed embedded in `0000` migration:** The `set_updated_at()` trigger and all 3 bucket template seed inserts are appended to the single generated migration file, avoiding numbering collisions.
- **`skipLibCheck: true` in tsconfig.server.json:** drizzle-orm 0.38 ships broken type declarations for mysql/sqlite/singlestore adapters. Added `skipLibCheck` to unblock the server build without affecting runtime correctness.
- **`db/index.ts` fail-fast:** Uses explicit null check (`if (!databaseUrl) throw`) instead of non-null assertion `!` to satisfy biome's `noNonNullAssertion` rule.
- **Migration meta files excluded from biome:** Added `!src/server/db/migrations/**` to biome `includes` to avoid formatter errors on Drizzle-generated JSON.

## Code Changes

- Created: `src/server/db/schema.ts` — all 8 tables
- Created: `src/server/db/index.ts` — Drizzle client with pg.Pool
- Created: `src/server/db/queries.ts` — all query functions
- Created: `src/server/db/migrations/0000_perfect_steve_rogers.sql` — initial migration (with trigger + seed embedded)
- Created: `src/server/db/migrations/meta/` — Drizzle-generated journal and snapshot
- Created: `tests/unit/db/queries.test.ts` — 10 integration tests
- Created: `tests/setup.ts` — sets DATABASE_URL default for tests
- Modified: `vitest.config.ts` — added `setupFiles: ["tests/setup.ts"]`
- Modified: `tsconfig.server.json` — added `skipLibCheck: true`
- Modified: `biome.json` — excluded `src/server/db/migrations/**`
- Modified: `src/client/main.tsx` — fixed pre-existing `noNonNullAssertion` lint error
- Modified: `.env.example` — updated DATABASE_URL to local Homebrew format

## Open Questions

- None blocking. Phase 2 is complete.

## Next Steps

- [ ] Phase 3: Token encryption (`src/server/crypto.ts`) + Google OAuth client (`src/server/google/auth.ts`)
- [ ] Phase 3: Auth routes + middleware (`src/server/auth.ts`)
- [ ] Prerequisite: GCP project setup must be done before Phase 3 can be tested end-to-end
