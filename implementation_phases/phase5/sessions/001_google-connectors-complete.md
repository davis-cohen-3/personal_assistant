# Session: Google Connectors Complete

**Date:** 2026-03-21
**Phase:** 5 — Google Connectors

## Summary

Implemented all three Google API connector files from scratch using TDD. All 103 tests pass. Also discovered and fixed an incorrect `asRaw()` vs `asEncoded()` assumption in the research doc and added attachment support to the Gmail connector.

## Key Decisions

- **`asEncoded()` not `asRaw()`**: The research doc incorrectly said `asRaw()` returns base64url-encoded MIME. The mimetext library's `asEncoded()` is the correct method for the Gmail API `raw` field. Fixed in connector and research doc.
- **`getSenderEmail()` helper**: `sendMessage`, `replyToThread`, and `createDraft` all fetch the sender's email via `gmail.users.getProfile({ userId: 'me' })` since `sendMessage` doesn't take a `from` param per spec. This adds one extra API call per send but is clean.
- **`replyToThread` fetches original metadata**: Uses `format: 'metadata'` (not `full`) to get the original message's `Message-ID`, `From`, and `Subject` headers for threading. Cheaper than `full` format.
- **Drive `translateQuery` helper**: Plain text queries → `fullText contains 'x' and trashed = false`. Queries already containing Drive DSL operators (contains, mimeType=, etc.) are passed through with just `and trashed = false` appended.
- **`EmailAttachment` interface**: Accepts `Buffer | string` for data — Buffers are auto-converted to base64 via `toBase64()` helper. Data must be standard base64 (not base64url) for mimetext.
- **FEAS-012 handling in `readDocument`**: Catches 403 errors whose message contains "export", "size", or "limit" and re-throws as a user-facing `AppError` with a clear 10MB message. All other errors are re-thrown unchanged.
- **`parseEvent` exported**: Made public so it can be called by tests directly and potentially by tools/routes that receive raw Google event objects.

## Code Changes

- Created: `src/server/google/gmail.ts`
- Created: `src/server/google/calendar.ts`
- Created: `src/server/google/drive.ts`
- Modified: `src/server/google/index.ts` — re-exports all three connectors
- Created: `tests/unit/google/gmail.test.ts` (33 tests)
- Created: `tests/unit/google/calendar.test.ts` (20 tests)
- Created: `tests/unit/google/drive.test.ts` (20 tests)
- Modified: `project_scoping/research/googleapis_reference.md` — fixed `asRaw()` → `asEncoded()` in all three examples, added Attachments section

## Issues Addressed

- **CLARITY-021**: `searchThreads` now has a typed `ThreadSummary[]` return type
- **FEAS-012**: `readDocument` catches and surfaces 10MB export limit as user-facing error

## Open Questions

- None blocking Phase 6+

## Next Steps

- [ ] Phase 6: `src/server/email.ts` orchestration layer (syncInbox, getThread, searchThreads — coordinates gmail.ts + queries.ts)
- [ ] Phase 7: MCP tools (`tools.ts`) and REST routes (`routes.ts`)
- [ ] Manual smoke test against real Google APIs after Phase 6 is wired
- [ ] Consider whether `replyToThread` should also accept `attachments` opts (currently only `sendMessage` and `createDraft` do)
