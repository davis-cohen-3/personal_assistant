# Session: WebSocket Root Cause + Chat UX + Layout Design

**Date:** 2026-03-22
**Phase:** 9 — Frontend App Shell + Chat UI + Agent Fixes

## Summary

Found and fixed the root cause of WebSocket 1005 drops: React effect cleanup was tearing down the socket because `openSocket` changed identity on every re-render. Fixed with callback refs. Implemented thinking indicator with tool status (Task 2) and markdown rendering (Task 3). Designed the new layout: dashboard-first with chat as a right panel, inbox/calendar tabs in the main area.

## Key Decisions

- **WebSocket drop root cause**: React's effect cleanup cascade. `onAgentDone` triggers 3 refetches → parent re-renders → `openSocket` gets new identity → effect re-runs → socket torn down. Fix: callback refs, `openSocket` has `[]` deps.
- **Detecting tool calls**: Use `content_block_start` stream events with `tool_use` type (not `tool_progress` which is unreliable).
- **Intermediate vs final text**: When `hasToolUse` is true, suppress `text_delta` forwarding. `text_done` provides authoritative final text. Simple no-tool responses still stream normally.
- **Tool display names**: `TOOL_DISPLAY_NAMES` constant maps MCP names to human-readable.

## Layout Redesign Decisions (for next session)

- **Structure**: Dashboard (main area) + ChatPanel (right sidebar ~320-400px)
- **Dashboard tabs**: Inbox (buckets + threads) and Calendar (week view)
- **Chat panel**: Conversation selector as dropdown in header, messages + input below. Support add/rename chats.
- **Thread detail**: Inline/expandable in inbox (not modal)
- **Calendar**: Week view (Mon-Sun), day-by-day list, today highlighted. One API call for 7-day window.
- **Inbox**: 5 threads per bucket initially, "Show more" to expand. Sorted by last_message_at desc.
- **Caching**: TTL-based (5 min). Only refetch active tab when agent used tools. Inactive tab catches up on switch if TTL expired.
- **Refetch strategy**: `onAgentDone` only refetches if tools were called (`toolNames.length > 0`). Only refetch the active tab. No per-tool granularity needed.
- **Data persistence**: Email threads/buckets in DB (persisted after agent sync). Calendar events NOT persisted — always live from Google. Thread detail always fetched fresh from Gmail.

## Code Changes

- Modified: `src/client/components/Chat.tsx` — callback refs, toolsUsed state, thinking indicator, ReactMarkdown
- Modified: `src/server/agent.ts` — tool detection, display names, intermediate text suppression
- Modified: `src/shared/types.ts` — `WsToolStatus`, `tools` on `ChatMessage`
- Modified: `src/server/index.ts` — EADDRINUSE kill-and-retry
- Added: `react-markdown`, `remark-gfm` dependencies

## Commits

- `aadecaf` — Fix WebSocket lifecycle: race conditions, reconnect logic, send guard
- `ac4501a` — Fix WebSocket drop: stable openSocket identity via callback refs
- `4637a0e` — Add thinking indicator with tool status + markdown rendering

## Next Steps

- [ ] Layout restructure: App.tsx → Dashboard + ChatPanel
- [ ] New InboxView component (buckets with inline thread detail)
- [ ] Updated CalendarView (week view, day-by-day list)
- [ ] ChatPanel (Chat + ConversationList merged, conversation dropdown)
- [ ] TTL caching on hooks, smart refetch
- [ ] Task 4: Remove Start Day button
- [ ] Task 5: Email reply feedback (BUG-3)
- [ ] Task 6: Archive → Trash (BUG-4)
