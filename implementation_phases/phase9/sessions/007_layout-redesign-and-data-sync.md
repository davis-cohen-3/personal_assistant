# Session: Layout Redesign + Dark Theme + Data Sync Design

**Date:** 2026-03-22
**Phase:** 9 — Frontend App Shell + Chat UI + Agent Fixes

## Summary

Restructured the frontend from a 3-column layout (ConversationList | Chat | Buckets+Calendar) to a dashboard-first layout with chat as a right panel. Added dark theme, fixed multiple contrast/readability issues, fixed calendar event bugs (attendee type mismatch crashing meetings, maxResults validation), and designed a clean data sync strategy for the next session.

## Key Decisions

- **Layout**: Full-width header (tabs + user avatar menu) spanning both dashboard and chat. Below: dashboard content (left, scrollable) + ChatPanel (right, 380px fixed).
- **Dark theme**: Deep navy-charcoal background, sky blue primary accent, DM Sans font. Iterated through several contrast fixes — buttons, dropdowns, message bubbles, thread detail all needed explicit `text-foreground` / `text-secondary-foreground`.
- **Chat panel**: Merged Chat.tsx + ConversationList.tsx into ChatPanel.tsx. Conversation selector is a dropdown in the header. `onAgentDone` now passes `toolNames[]` so App can decide what to refetch.
- **Inbox tab**: Buckets as sections with thread cards (sender, subject, snippet, time). 5 per bucket with "Show more". Thread detail is inline expandable (converted from modal).
- **Calendar tab**: Week view (Mon-Sun), day-by-day list, today highlighted with primary dot. Events expand inline (converted EventDetail from modal). Removed Edit/Delete buttons from EventDetail (read-only).
- **Trash fix**: `email.trashThread` now also calls `queries.unassignThread()` to remove from DB so thread disappears from inbox on refetch.
- **Meeting crash fix**: Frontend `CalendarEvent.attendees` was typed as `string[]` but server returns `CalendarEventAttendee[]` (objects). Rendering objects as React children crashed the page. Fixed type + render.
- **EventDetail HTML stripping**: Event descriptions from Google come with raw HTML. Added `sanitizeHtml()` to strip tags, `renderWithLinks()` to make URLs clickable.

## Data Sync Design (approved, not yet implemented)

Both Gmail and Calendar follow: **poll every 5 min + refetch on mutation**.

**Backend:**
1. New `POST /api/gmail/sync` — lightweight sync (25 threads), frontend polls this
2. `replyToThread` — after Gmail reply, re-sync that single thread from Gmail → DB
3. `getThread` — read from DB first, only hit Gmail API if not found

**Frontend:**
4. `useBuckets` — replace TTL/visibility with `setInterval` polling: sync → refetch buckets
5. `useCalendarEvents` — replace TTL/visibility with `setInterval` polling
6. `App.tsx handleAgentDone` — refetch active tab on agent tool use (no TTL logic)
7. `ThreadDetail` — after reply, backend already synced, just reload from DB route

## Code Changes

- Created: `src/client/components/ChatPanel.tsx` (merged Chat + ConversationList)
- Created: `src/client/components/InboxView.tsx` (replaced BucketBoard)
- Deleted: `src/client/components/BucketBoard.tsx`, `Chat.tsx`, `ConversationList.tsx`
- Modified: `src/client/App.tsx` — full restructure, tabs, UserMenu, full-width header
- Modified: `src/client/components/CalendarView.tsx` — week view, day-by-day list, inline EventDetail
- Modified: `src/client/components/ThreadDetail.tsx` — modal → inline expandable
- Modified: `src/client/components/EventDetail.tsx` — modal → inline, removed Edit/Delete, HTML stripping, attendee type fix
- Modified: `src/client/globals.css` — dark theme, DM Sans font
- Modified: `src/client/index.html` — Google Fonts link
- Modified: `src/client/components/ui/button.tsx` — added `text-foreground` to outline/ghost variants
- Modified: `src/client/hooks/useBuckets.ts` — enriched BucketThread type (from_name, from_email, last_message_at), TTL caching
- Modified: `src/client/hooks/useCalendarEvents.ts` — 7-day window, CalendarEventAttendee type, TTL caching
- Modified: `src/server/db/queries.ts` — `listBucketsWithThreads` joins emailThreads for from/time data
- Modified: `src/server/email.ts` — `trashThread` calls `unassignThread`, `getThread` reads DB first
- Modified: `tests/unit/email.test.ts` — added `mockUnassignThread`, updated trashThread test

## Commits

- None yet — all changes are uncommitted staged/unstaged

## Next Steps

- [ ] Implement data sync strategy (backend: sync route, reply re-sync; frontend: polling hooks)
- [ ] Commit all layout + dark theme + bug fix changes
- [ ] Test end-to-end: reply shows in thread, trash removes from inbox, polling keeps data fresh
- [ ] Phase 10 tasks: email reply feedback (BUG-3), archive → trash (BUG-4)
