# Session: Email Orchestration Layer

**Date:** 2026-03-21
**Phase:** 6 — Email Orchestration

## Summary

Built `src/server/email.ts` — the orchestration layer between `gmail.ts` and `db/queries.ts` — using TDD. Wrote 27 unit tests in `tests/unit/email.test.ts` that mock both dependencies; all 132 tests in the suite pass. Also noted a deferred attachment limitation as MIN-016.

## Key Decisions

- `extractBodyText` is a private helper (not exported): tested indirectly through `syncInbox` since no test imports it directly — keeps the public API minimal.
- Used `mock.lastCall` instead of `mock.calls[0]` in tests to avoid stale-call bugs when `beforeEach` wasn't clearing mocks across extractBodyText tests.
- `email.ts` `sendMessage` narrows opts to `{ cc?: string[] }` per the spec — attachments deferred to v2 (noted as MIN-016 in `issues_to_be_aware_of.md`).
- `parseFrom` + `toThreadRecord` + `toMessageRecords` are private helpers that map Gmail API shapes to DB shapes; none are exported.
- `getThread` always re-fetches from Gmail (no cache check) per MIN-003 — accepted for v1.

## Code Changes

- Created: `src/server/email.ts`
- Created: `tests/unit/email.test.ts`
- Modified: `project_scoping/design/issues_to_be_aware_of.md` — added MIN-016 (attachment support deferred to v2)

## Open Questions

- None blocking.

## Next Steps

- [ ] Phase 7: MCP tools (`src/server/tools.ts`) + tests
- [ ] Phase 7: REST routes (`src/server/routes.ts`) + tests
- [ ] Both Phase 7 tasks can be run as parallel subagents
