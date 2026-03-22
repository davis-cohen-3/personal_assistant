# Session: Remove Start Day button & archive → trash

**Date:** 2026-03-22
**Phase:** 9 — Frontend App Shell + Chat UX

## Summary

Reviewed phase 10 spec against recent commits to identify remaining work. Completed Task 4 (remove "Start Day" button) and Task 6 (replace archive with trash across the full stack). All 205 tests pass, build clean.

## Key Decisions

- Archive → Trash: uses `gmail.users.threads.trash()` instead of label removal, which actually deletes threads rather than just hiding them from inbox
- Renamed prop `onArchive` → `onTrash` throughout component tree for consistency

## Code Changes

- Modified: `src/client/components/Chat.tsx` — removed Start Day button
- Modified: `src/client/components/ThreadDetail.tsx` — archive → trash (handler, button, prop)
- Modified: `src/client/App.tsx` — `onArchive` → `onTrash` prop
- Modified: `src/server/google/gmail.ts` — `archiveThread` → `trashThread` using `threads.trash()`
- Modified: `src/server/google/index.ts` — updated re-export
- Modified: `src/server/email.ts` — renamed orchestration function
- Modified: `src/server/routes.ts` — `/archive` → `/trash` endpoint
- Modified: `src/server/tools.ts` — MCP tool action enum, handler, description
- Modified: `tests/unit/google/gmail.test.ts` — added `mockThreadsTrash`, updated test
- Modified: `tests/unit/email.test.ts` — renamed mocks and test
- Modified: `tests/unit/routes.test.ts` — renamed mocks, updated endpoint
- Modified: `tests/unit/tools.test.ts` — renamed mocks, updated action

## Phase 10 Status

| Task | Status |
|------|--------|
| Task 1: WebSocket lifecycle fix (BUG-1, BUG-2) | Done |
| Task 2: Thinking indicator + tool status (UX-1, UX-2) | Done |
| Task 3: Markdown rendering (UX-3) | Done |
| Task 4: Remove Start Day button (UX-4) | Done (this session) |
| Task 5: Email reply feedback (BUG-3) | Done |
| Task 6: Archive → Trash (BUG-4) | Done (this session) |
| Task 7: Layout redesign | Not started |

## Next Steps

- [ ] Task 7: Layout redesign — dashboard-first layout (chat to left sidebar, buckets/calendar center)
- [ ] Update phase 10 spec with completion status
