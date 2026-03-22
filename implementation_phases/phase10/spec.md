# Phase 10: Chat UX Polish & WebSocket Reliability

## Current State

The chat UI is functional but rough. The agent works end-to-end (WebSocket → Agent SDK → MCP tools → streamed response), but several UX and reliability gaps make it feel broken in practice.

### What Works
- Message sending is disabled while agent is processing (`loading` flag)
- WebSocket has reconnection logic with exponential backoff
- Conversation CRUD (create, list, delete) works
- Agent responses stream token-by-token via `text_delta` events
- One active WebSocket per conversation (switching closes the old one)

### What's Broken or Missing

## Bug Fixes

### BUG-1: Can't send messages in continued conversations

**Symptom:** After the agent responds, the user cannot send a follow-up message. Input appears enabled but nothing happens on send.

**Root cause:** The server closes the WebSocket after each agent response. The client's `onclose` handler reconnects, but after 3 clean reconnects (`MAX_CLEAN_RECONNECTS`), it falls into the "connection lost" path. Each reconnect opens a socket that gets immediately closed by the server (no active query), burning through the limit.

**The real problem:** The server-side WebSocket lifecycle doesn't match the client's expectations. The server treats each WebSocket as single-use (open → query → close), but the client expects a persistent connection for the life of the conversation.

**Evidence:**
- `logs/server.log` shows repeated `WebSocket closed { code: 1005, wasClean: false }` after each response
- `agent.ts:243` sends `text_done` then the function returns, which causes hono-ws to close the socket
- `Chat.tsx:102-114` reconnects up to 3 times on clean close, then gives up

**Fix options:**
1. **Keep WebSocket alive** (preferred) — Don't close the socket after `streamQuery` completes. Keep it open for subsequent messages. The `onMessage` handler in `handleWebSocket` already supports receiving multiple messages on the same socket.
2. **Increase reconnect tolerance** — Fragile, doesn't fix the underlying issue.

### BUG-2: WebSocket close code 1005 (no status)

**Symptom:** All WebSocket closes show `code: 1005, wasClean: false` in logs.

**Root cause:** The server never explicitly closes the WebSocket with a status code. When `streamQuery` finishes and the handler returns, hono-ws closes without a proper code.

**Fix:** This should resolve naturally with BUG-1 (keeping the socket alive). For error cases, explicitly close with appropriate codes (1000 for normal, 1008 for policy violation, etc.).

### BUG-3: No feedback after sending email reply in ThreadDetail

**Symptom:** User clicks Reply in a thread, email sends successfully, but the only visible change is the textarea clears. No confirmation, no thread refresh. User has to check Gmail to verify it sent.

**Root cause:** `ThreadDetail.tsx:57-68` — `handleReply` clears `replyBody` on success but:
- No success toast/banner
- Doesn't re-fetch the thread (so the sent reply doesn't appear in the message list)
- No visual state change at all

**Fix:**
1. After successful reply, re-fetch the thread so the sent message appears in the list
2. Show a brief "Reply sent" confirmation (inline banner or the reply area itself)
3. Auto-scroll to the new message

**File:** `src/client/components/ThreadDetail.tsx`

### BUG-4: Archive button should trash, not archive

**Symptom:** User expects "Archive" to delete/remove the thread, but it only removes the INBOX label in Gmail. Thread is still accessible.

**Change:** Replace archive with trash across the full stack. Rename button to "Trash".

**Files and changes:**
- `src/server/google/gmail.ts:266-273` — Replace `archiveThread` with `trashThread` using `gmail.users.threads.trash()`
- `src/server/google/index.ts:35` — Update re-export
- `src/server/email.ts:147-150` — Rename `archiveThread` → `trashThread`
- `src/server/routes.ts:103-106` — Rename route `/gmail/threads/:id/archive` → `/gmail/threads/:id/trash`
- `src/server/tools.ts:175-178` — Rename MCP tool action `archive` → `trash`, update call
- `src/client/components/ThreadDetail.tsx:71-78,86` — Update endpoint URL, rename button label to "Trash"

## UX Improvements

### UX-1: No loading indicator while agent is working

**Current:** Spinner only shows when loading an empty conversation. Once messages exist, there's zero visual feedback that the agent is processing.

**Fix:** Show a "thinking" indicator below the last message while `loading === true`. A pulsing dot or skeleton bubble in the assistant message style.

### UX-2: No tool call visibility

**Current:** `tool_progress` events from the Agent SDK are logged server-side only. The user has no idea what the agent is doing (reading email? searching calendar? reading drive files?).

**Fix:**
1. **Backend:** Forward `tool_progress` events over WebSocket as a new message type `tool_status`
2. **Shared types:** Add `WsToolStatus` to `WsServerMessage` union
3. **Frontend:** Show tool calls in the thinking indicator (e.g., "Reading emails..." → "Searching calendar..." → "Reading drive files...")

New WebSocket message:
```typescript
interface WsToolStatus {
  type: "tool_status";
  toolName: string;        // e.g. "mcp__assistant-tools__sync_email"
  displayName: string;     // e.g. "Reading emails"
}
```

### UX-3: Agent responses render as raw text (no markdown)

**Current:** `{msg.text}` renders markdown syntax literally. Bold shows as `**text**`, headers as `## text`, tables as pipes.

**Fix:**
1. Install `react-markdown` + `remark-gfm` (for tables, strikethrough)
2. Render assistant messages through `<ReactMarkdown>` component
3. Style markdown elements to match the chat theme (prose classes)

### UX-4: Remove "Start Day" button

**Current:** Empty conversation shows a "Start Day" button that sends "Start my day" as a hardcoded message.

**Fix:** Remove the button. Keep the "Ready when you are." placeholder text, or replace with something more useful like input focus.

## Implementation Plan

### Task 1: Fix WebSocket lifecycle (BUG-1, BUG-2)

**Files:** `src/server/agent.ts`, `src/client/components/Chat.tsx`

Backend changes:
- `handleWebSocket.onMessage` should NOT return after `streamQuery`. The socket stays open.
- Remove any implicit close after query completion.
- Only close on explicit disconnect or error.

Frontend changes:
- Simplify reconnection logic. With a persistent socket, clean closes should only happen on server restart or network issues.
- Remove `MAX_CLEAN_RECONNECTS` counter — it's no longer needed.
- Keep backoff reconnection for unclean closes (server crash/network drop).

### Task 2: Add thinking indicator + tool status (UX-1, UX-2)

**Files:** `src/shared/types.ts`, `src/server/agent.ts`, `src/client/components/Chat.tsx`

Backend:
- In `streamQuery`, forward `tool_progress` events to WebSocket as `tool_status` messages
- Map MCP tool names to human-readable display names

Frontend:
- When `loading === true` and messages exist, show a thinking indicator after the last message
- Update the indicator with tool names as `tool_status` events arrive
- Clear the indicator when `text_delta` starts streaming

Shared types:
```typescript
export interface WsToolStatus {
  type: "tool_status";
  toolName: string;
  displayName: string;
}
```

### Task 3: Markdown rendering (UX-3)

**Files:** `package.json`, `src/client/components/Chat.tsx`

- `pnpm add react-markdown remark-gfm`
- Wrap assistant message text in `<ReactMarkdown remarkPlugins={[remarkGfm]}>`
- Add prose styling for rendered markdown (headings, bold, lists, tables, code blocks)

### Task 4: Remove Start Day button (UX-4)

**Files:** `src/client/components/Chat.tsx`

- Remove the `<Button onClick={() => send("Start my day")}>Start Day</Button>`
- Keep or update the empty state placeholder

### Task 5: Email reply feedback (BUG-3)

**Files:** `src/client/components/ThreadDetail.tsx`

- After successful reply, re-fetch the thread to show the sent message
- Show a brief "Reply sent" inline confirmation
- Auto-scroll to the bottom of the message list

## Task Order

1. **Task 1 (WebSocket fix)** — Must be first, everything else depends on a working connection
2. **Task 2 (Thinking + tools)** — Depends on stable WebSocket
3. **Task 3 (Markdown)** — Independent, can be done in parallel with Task 2
4. **Task 4 (Remove button)** — Trivial, do last or alongside anything
5. **Task 5 (Reply feedback)** — Independent, can be done in parallel with anything
6. **Task 6 (Archive → Trash)** — Independent, can be done in parallel with anything
7. **Task 7 (Layout redesign)** — After all bug fixes and UX items are done

### Task 7: Layout redesign — dashboard-first layout

**Current layout:**
```
┌──────────┬────────────────────────────┬──────────┐
│ Convos   │         Chat (center)      │ Buckets  │
│ Sidebar  │                            │ Calendar │
│ (w-64)   │                            │ (w-80)   │
└──────────┴────────────────────────────┴──────────┘
```

**Problem:** Chat takes center stage but you mostly glance at buckets/calendar. The right sidebar is cramped (320px) for showing bucket boards and events.

**New layout:**
```
┌──────────┬────────────────────────────┬──────────┐
│ Chat     │      Dashboard (center)    │          │
│ Sidebar  │  ┌────────┐ ┌───────────┐ │          │
│          │  │Buckets │ │ Calendar  │ │          │
│ (w-80)   │  │ Board  │ │  Events   │ │          │
│          │  └────────┘ └───────────┘ │          │
└──────────┴────────────────────────────┴──────────┘
```

**Changes:**
- Chat moves to the left sidebar (collapsible, ~320-400px wide)
- Conversation list becomes a dropdown/selector within the chat sidebar header (instead of its own column)
- Dashboard (buckets + calendar) takes the center, full width
- Buckets and calendar can use a responsive grid layout with more room
- ThreadDetail and EventDetail modals stay as-is (overlays)

**Files:**
- `src/client/App.tsx` — Restructure layout, merge conversation list into chat sidebar
- `src/client/components/Chat.tsx` — Adapt to sidebar width, add collapse/expand toggle
- `src/client/components/ConversationList.tsx` — Convert to dropdown selector or compact list within chat header
- `src/client/components/BucketBoard.tsx` — Expand to use available center space
- `src/client/components/CalendarView.tsx` — Expand to use available center space
- `src/client/globals.css` — Any layout-level styles

## Files Changed

| File | Tasks |
|------|-------|
| `src/server/agent.ts` | 1, 2 |
| `src/server/google/gmail.ts` | 6 |
| `src/server/google/index.ts` | 6 |
| `src/server/email.ts` | 6 |
| `src/server/routes.ts` | 6 |
| `src/server/tools.ts` | 6 |
| `src/client/components/Chat.tsx` | 1, 2, 3, 4 |
| `src/client/components/ThreadDetail.tsx` | 5, 6 |
| `src/shared/types.ts` | 2 |
| `package.json` | 3 |
| `src/client/App.tsx` | 7 |
| `src/client/components/ConversationList.tsx` | 7 |
| `src/client/components/BucketBoard.tsx` | 7 |
| `src/client/components/CalendarView.tsx` | 7 |
| `src/client/globals.css` | 7 |
