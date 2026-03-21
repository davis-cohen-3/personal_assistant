# Frontend

## Overview

React SPA built with Vite. Styled with **Tailwind CSS** and **shadcn/ui** components. Two interaction paths:

1. **Agent chat (WebSocket)** — LLM-powered classification, triage, drafting. Agent returns text responses only — no dynamic UI components. The agent writes data via tools, and the frontend renders from current state via REST API.
2. **Direct UI (REST)** — User views buckets, threads, and events. Frontend calls `/api/*` endpoints directly — no agent involved.

All frontend code lives in `src/client/`.

---

## Styling

- **Tailwind CSS** — utility-first CSS framework
- **shadcn/ui** — component library built on Radix UI primitives, styled with Tailwind
- Loading states use **spinners** (shadcn Spinner / Loader component)
- Error states render inline error messages with retry buttons where applicable

---

## App Structure

```typescript
// src/client/main.tsx
import { createRoot } from 'react-dom/client';
import App from './App';
import './globals.css'; // Tailwind base styles

createRoot(document.getElementById('root')!).render(<App />);
```

```typescript
// src/client/App.tsx
import { useState, useEffect, useCallback } from 'react';
import ConversationList from './components/ConversationList';
import Chat from './components/Chat';
import BucketBoard from './components/BucketBoard';
import CalendarView from './components/CalendarView';
import ThreadDetail from './components/ThreadDetail';
import EventDetail from './components/EventDetail';
import { useBuckets } from './hooks/useBuckets';
import { useCalendarEvents } from './hooks/useCalendarEvents';
import { useConversations } from './hooks/useConversations';

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<string | null>(null);   // gmail thread id
  const [activeEvent, setActiveEvent] = useState<string | null>(null);     // calendar event id

  // Data hooks — each is the single source of truth for its resource
  const bucketsHook = useBuckets();
  const calendarHook = useCalendarEvents();
  const conversationsHook = useConversations();

  // Called by Chat on text_done — refetch all data after agent response completes
  const handleAgentDone = useCallback(() => {
    bucketsHook.refetch();
    calendarHook.refetch();
    conversationsHook.refetch();
  }, [bucketsHook.refetch, calendarHook.refetch, conversationsHook.refetch]);

  useEffect(() => {
    // Check auth status on mount via /auth/status
    // If not authenticated, redirect to /auth/google
  }, []);

  if (!authenticated) return <GoogleLoginRedirect />;

  return (
    <div className="app flex h-screen">
      {/* Left sidebar: Conversation list */}
      <ConversationList
        activeConversationId={activeConversationId}
        onSelect={(id) => setActiveConversationId(id)}
        onNewChat={(id) => setActiveConversationId(id)}
        conversationsHook={conversationsHook}
      />

      {/* Center panel: Agent chat — owns its own WebSocket, scoped to active conversation */}
      <Chat
        conversationId={activeConversationId}
        onAgentDone={handleAgentDone}
        onTitleUpdate={() => conversationsHook.refetch()}
      />

      {/* Right panel: Data-driven UI panels — render from REST API state */}
      <div className="data-panels flex-1 overflow-y-auto">
        <BucketBoard bucketsHook={bucketsHook} onThreadClick={(threadId) => setActiveThread(threadId)} />
        <CalendarView calendarHook={calendarHook} onEventClick={(eventId) => setActiveEvent(eventId)} />
      </div>

      {/* Detail panels — open when user clicks a thread/event */}
      {activeThread && (
        <ThreadDetail
          threadId={activeThread}
          onClose={() => setActiveThread(null)}
          onArchive={() => { setActiveThread(null); bucketsHook.refetch(); }}
        />
      )}
      {activeEvent && (
        <EventDetail
          eventId={activeEvent}
          onClose={() => setActiveEvent(null)}
        />
      )}
    </div>
  );
}
```

---

## ConversationList Component

Sidebar component that lists past conversations and provides a "New Chat" button. Always visible on the left edge of the app.

```typescript
// src/client/components/ConversationList.tsx (conceptual)
import { Button } from '@/components/ui/button';
import { useConversations } from '../hooks/useConversations';

interface Props {
  activeConversationId: string | null;
  onSelect: (id: string | null) => void;
  onNewChat: (id: string) => void;
  conversationsHook: ReturnType<typeof useConversations>; // passed from App.tsx — single source of truth
}

export default function ConversationList({ activeConversationId, onSelect, onNewChat, conversationsHook }: Props) {
  const { conversations, createConversation, deleteConversation } = conversationsHook;

  const handleNewChat = async () => {
    const conversation = await createConversation();
    onNewChat(conversation.id);
  };

  const handleDelete = async (id: string) => {
    await deleteConversation(id);
    if (activeConversationId === id) {
      const remaining = conversations.filter(c => c.id !== id);
      onSelect(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  return (
    <div className="w-64 border-r flex flex-col h-full">
      <div className="p-3 border-b">
        <Button onClick={handleNewChat} className="w-full">New Chat</Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.map(conv => (
          <div
            key={conv.id}
            className={`p-3 cursor-pointer hover:bg-muted ${conv.id === activeConversationId ? 'bg-muted' : ''}`}
            onClick={() => onSelect(conv.id)}
          >
            <p className="text-sm font-medium truncate">{conv.title}</p>
            <p className="text-xs text-muted-foreground">{formatRelativeTime(conv.updated_at)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Behavior:**
- `useConversations()` hook fetches on mount and refetches after its own mutations
- "New Chat" calls `createConversation()` (hook mutation), then selects the new conversation
- Clicking a conversation calls `onSelect` to switch the active conversation
- Each conversation shows title (truncated) and relative timestamp
- Delete via button on hover
- Title updates arrive via `conversation_updated` WebSocket message — Chat component calls `useConversations().refetch()` when it receives one

---

## Chat Component

The core component. Owns its own WebSocket connection scoped to a single conversation. Opens the WebSocket when a conversation is active, closes and reconnects when the user switches conversations. Loads message history from Postgres on conversation switch, then receives streamed tokens via WebSocket. The agent does not return UI components — it writes data via tools, and the rest of the frontend reflects those changes by fetching from the REST API.

When the agent proposes a side-effect action (sending email, creating event), it describes the action in text and waits for the user to confirm in chat (e.g., "go ahead", "yes", "send it"). No special buttons — approval is a normal chat message.

**Data freshness after agent responses:** When the Chat component receives `text_done`, it calls `onAgentDone()` — a callback from `App.tsx` that triggers `refetch()` on all active data hooks (`useBuckets`, `useCalendarEvents`, `useConversations`). This is the only mechanism for agent-initiated writes to propagate to data panels. No server-side event system needed.

```typescript
// src/client/components/Chat.tsx
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import type { ChatMessage } from '../../shared/types';

interface Props {
  conversationId: string | null;
  onAgentDone: () => void;        // called on text_done — App triggers data hook refetches
  onTitleUpdate: () => void; // called on conversation_updated — App.tsx refetches conversations
}

export default function Chat({ conversationId, onAgentDone, onTitleUpdate }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Load message history when conversationId changes
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    // Fetch existing messages from Postgres
    setLoading(true);
    fetchApi(`/api/conversations/${conversationId}`)
      .then(r => r.json())
      .then(data => {
        setMessages(data.messages.map(m => ({ role: m.role, text: m.content })));
        setLoading(false);
      });
  }, [conversationId]);

  // Manage WebSocket connection — one per conversation
  useEffect(() => {
    if (!conversationId) return;

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${window.location.host}/ws?conversationId=${conversationId}`);
    wsRef.current = socket;

    socket.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data);

      if (data.type === 'text_delta') {
        // Accumulate streaming tokens into current assistant message
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            return [...prev.slice(0, -1), { ...last, text: last.text + data.content }];
          }
          return [...prev, { role: 'assistant', text: data.content, streaming: true }];
        });
      }

      if (data.type === 'text_done') {
        // Stream complete — replace with final message
        setMessages(prev => {
          const withoutStreaming = prev.filter(m => !m.streaming);
          return [...withoutStreaming, { role: 'assistant', text: data.content }];
        });
        // Trigger data hook refetches — agent may have written data via tools
        onAgentDone();
      }

      if (data.type === 'error') {
        setMessages(prev => [...prev, { role: 'system', text: data.message }]);
      }

      if (data.type === 'conversation_updated') {
        onTitleUpdate(data.title);
      }
    };

    // Reconnect with exponential backoff on unexpected close
    socket.onclose = (event) => {
      if (!event.wasClean) {
        // TODO: show "Connection lost" banner, implement reconnect with backoff
      }
    };

    return () => {
      socket.close();
      wsRef.current = null;
    };
  }, [conversationId, onAgentDone, onTitleUpdate]);

  const send = (content: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'chat', content }));
    setMessages(prev => [...prev, { role: 'user', text: content }]);
    setInput('');
  };

  // Empty state — no conversation selected
  if (!conversationId) {
    return (
      <div className="chat flex items-center justify-center h-full text-muted-foreground">
        Select a conversation or start a new chat
      </div>
    );
  }

  if (loading) return <Spinner />;

  return (
    <div className="chat flex flex-col h-full">
      <div className="messages flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <p className="text-muted-foreground">Ready when you are.</p>
            <Button onClick={() => send('Start my day')}>Start Day</Button>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <p>{msg.text}</p>
            </div>
          ))
        )}
      </div>

      <form className="p-4 border-t" onSubmit={(e) => { e.preventDefault(); if (!loading) send(input); }}>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border px-3 py-2"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={loading}
          />
          <Button type="submit" disabled={loading}>Send</Button>
        </div>
      </form>
    </div>
  );
}
```

---

## WebSocket Client

The WebSocket connection is owned by the Chat component, not by a provider. It connects to `/ws?conversationId=xxx` when a conversation is active. On conversation switch, the old socket closes and a new one opens.

```typescript
// Frontend → Backend
{ type: 'chat', content: string }  // user message
```

```typescript
// Backend → Frontend
{ type: 'text_delta', content: string }       // streaming token
{ type: 'text_done', content: string }        // full response when stream completes
{ type: 'error', message: string }
{ type: 'conversation_updated', conversationId: string, title: string }
```

Connection lifecycle:
- Connect when a conversation is selected (`/ws?conversationId=xxx`). No connection when no conversation is active.
- On conversation switch, close the old socket and open a new one with the new `conversationId`
- Reconnect with exponential backoff on unexpected disconnect
- Session cookie authenticates the WebSocket upgrade (same-origin)
- On disconnect, show a "Connection lost" banner in the chat panel with a Reconnect button
- On reconnect after Railway scale-to-zero: SDK session may be lost, but message history is loaded from Postgres. Agent starts with fresh context while UI shows full message history
- If any REST call returns 401 (session expired), close the WebSocket and redirect to `/auth/google` for re-authentication

---

## Data Hooks

Three custom hooks own all data fetching and mutation for their respective resources. Each hook is the single source of truth for its data — components never call `fetch` directly for these resources.

Each hook:
- Fetches on mount via REST
- Exposes mutation functions that refetch on success
- Exposes a `refetch()` function that `App.tsx` can call after agent responses
- Deduplicates — if a refetch is already in flight, a second trigger is ignored

```typescript
// src/client/hooks/useBuckets.ts (conceptual)
export function useBuckets() {
  const [buckets, setBuckets] = useState<BucketWithThreads[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  const refetch = useCallback(async () => {
    if (fetchingRef.current) return; // deduplicate
    fetchingRef.current = true;
    setError(null);
    try {
      const res = await fetchApi('/api/buckets');
      if (!res.ok) throw new Error(`Failed to fetch buckets: ${res.status}`);
      const { data } = await res.json();
      setBuckets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch buckets');
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => { refetch(); }, [refetch]);

  // Refetch on window focus — keeps data fresh when user switches back to the tab
  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') refetch(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [refetch]);

  // Mutations — refetch on success
  const createBucket = async (name: string, description: string) => {
    const result = await fetchApi('/api/buckets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    await refetch();
    return result; // includes rebucket_required: true — caller can prompt user to ask agent to re-sort
  };

  const updateBucket = async (id: string, updates: { name?: string; description?: string }) => {
    await fetchApi(`/api/buckets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    await refetch();
  };

  const deleteBucket = async (id: string) => {
    await fetchApi(`/api/buckets/${id}`, { method: 'DELETE' });
    await refetch();
  };

  const assignThread = async (gmailThreadId: string, bucketId: string) => {
    await fetchApi('/api/buckets/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gmail_thread_id: gmailThreadId, bucket_id: bucketId }),
    });
    await refetch();
  };

  return { buckets, loading, error, refetch, createBucket, updateBucket, deleteBucket, assignThread };
}
```

### Hook summary

| Hook | Fetches from | Mutations | Refetch triggers |
|---|---|---|---|
| `useBuckets` | `GET /api/buckets` | `createBucket`, `updateBucket`, `deleteBucket`, `assignThread` | on mount, after own mutations, on `onAgentDone` |
| `useCalendarEvents` | `GET /api/calendar/events` | `createEvent`, `updateEvent`, `deleteEvent` | on mount, after own mutations, on `onAgentDone` |
| `useConversations` | `GET /api/conversations` | `createConversation`, `updateConversation`, `deleteConversation` | on mount, after own mutations, on `onAgentDone` |

Three refetch triggers, one refetch function, no overlap:
1. **Local mutation** — the hook's own mutation function calls `refetch()` on success
2. **Agent response complete** — Chat component receives `text_done` → calls `onAgentDone()` → `App.tsx` calls `refetch()` on all active hooks
3. **Window focus** — `visibilitychange` listener calls `refetch()` when the tab becomes visible again

No `WebSocketProvider`, no `useDataChangedEvent`, no `data_changed` events, no `EventEmitter`. The WebSocket is owned by Chat and used only for agent streaming.

---

## Data-Driven UI Components

These components render data from the hooks above. They are always visible in the UI (not embedded in chat). When the user mutates via direct UI, hooks refetch after the mutation. When the agent writes data via tools, hooks refetch when the agent response completes (`text_done`).

### BucketBoard (`src/client/components/BucketBoard.tsx`)

Kanban-style board of email buckets. Uses `useBuckets()` hook. Each bucket is a column; threads are cards showing subject, snippet, and sender. **Clicking a thread card** opens `ThreadDetail` via `onThreadClick(threadId)` — this triggers a direct REST call, not an agent interaction.

Shows a spinner while loading. Shows an empty state if no buckets exist yet (with a prompt to pick a template).

### CalendarView (`src/client/components/CalendarView.tsx`)

Shows today's events (and optionally tomorrow's). Uses `useCalendarEvents()` hook. Each event is a card showing time, title, and attendees. **Clicking an event card** opens `EventDetail` via `onEventClick(eventId)`.

Shows a spinner while loading.

---

## Direct UI Components

These components render when the user clicks into a specific thread or event. They call the REST API directly — no agent round-trip.

### ThreadDetail (`src/client/components/ThreadDetail.tsx`)

Opens when the user clicks a thread card in BucketBoard.

- Fetches full thread via `GET /api/gmail/threads/:id`
- Shows a spinner while loading
- Renders all messages in the thread (sender, date, body)
- **Reply** — inline compose box, sends via `POST /api/gmail/threads/:id/reply`
- **Archive** — button, calls `POST /api/gmail/threads/:id/archive`
- **Mark read** — auto on open, marks the latest message via `POST /api/gmail/messages/:id/read` (most recent message is typically the unread one)

```typescript
// src/client/components/ThreadDetail.tsx (conceptual)
export default function ThreadDetail({ threadId, onClose, onArchive }: Props) {
  const [thread, setThread] = useState(null);
  const [loading, setLoading] = useState(true);
  const [replyBody, setReplyBody] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchApi(`/api/gmail/threads/${threadId}`)
      .then(r => r.json())
      .then(setThread)
      .finally(() => setLoading(false));
  }, [threadId]);

  if (loading) return <Spinner />;

  const handleReply = async () => {
    const lastMessage = thread.messages[thread.messages.length - 1];
    await fetchApi(`/api/gmail/threads/${threadId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: replyBody, messageId: lastMessage.gmail_message_id }),
    });
    setReplyBody('');
    // refresh thread
  };

  const handleArchive = async () => {
    const lastMessage = thread.messages[thread.messages.length - 1];
    await fetchApi(`/api/gmail/threads/${threadId}/archive`, { method: 'POST' });
    onArchive();
  };

  // Render: message list + reply box + archive button
  // IMPORTANT: Render email body as plain text only. Never use dangerouslySetInnerHTML.
  // Email HTML can contain scripts, tracking pixels, and XSS vectors.
  // The backend stores body_text (truncated plain text) — render it in a <pre> or styled <div>.
}
```

### EventDetail (`src/client/components/EventDetail.tsx`)

Opens when the user clicks an event card in CalendarView.

- Fetches full event via `GET /api/calendar/events/:id`
- Shows a spinner while loading
- Renders title, time, location, attendees, description
- **Edit** — inline form fields, saves via `PATCH /api/calendar/events/:id`
- **Delete** — button with confirmation prompt, calls `DELETE /api/calendar/events/:id`

```typescript
// src/client/components/EventDetail.tsx (conceptual)
export default function EventDetail({ eventId, onClose }: Props) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchApi(`/api/calendar/events/${eventId}`)
      .then(r => r.json())
      .then(setEvent)
      .finally(() => setLoading(false));
  }, [eventId]);

  if (loading) return <Spinner />;

  const handleSave = async (updates) => {
    const updated = await fetchApi(`/api/calendar/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }).then(r => r.json());
    setEvent(updated);
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!confirm('Cancel this event?')) return;
    await fetchApi(`/api/calendar/events/${eventId}`, { method: 'DELETE' });
    onClose();
  };

  // Render: event details + edit form + delete button
}
```

---

## Auth Check

Google OAuth is the only login. Cookie-only auth — the httpOnly session cookie authenticates all requests. CSRF protection via `X-CSRF-Token` header on state-changing requests.

```typescript
// src/client/fetchApi.ts — shared fetch wrapper with CSRF
let csrfToken: string | null = null;

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  // Attach CSRF token on state-changing methods
  const method = (init?.method ?? 'GET').toUpperCase();
  if (csrfToken && method !== 'GET') {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });

  // Global 401 interceptor — session expired or token revoked.
  // Redirect to OAuth login. This is the single place that handles re-auth
  // for all REST calls across all hooks and components.
  if (res.status === 401) {
    window.location.href = '/auth/google';
    // Return the response so callers don't need special handling —
    // the redirect will interrupt execution.
    return res;
  }

  return res;
}
```

```typescript
// In App.tsx
useEffect(() => {
  // Check auth status and get CSRF token — works on both initial login and page refresh
  fetch('/auth/status')
    .then(r => r.json())
    .then(({ authenticated, csrfToken }) => {
      if (!authenticated) {
        window.location.href = '/auth/google';
      } else {
        setCsrfToken(csrfToken);
        setAuthenticated(true);
      }
    });
}, []);
```

All data hooks (`useBuckets`, `useCalendarEvents`, `useConversations`) and detail components (`ThreadDetail`, `EventDetail`) use `fetchApi()` instead of raw `fetch()` for REST calls. The session cookie is auto-attached by the browser; `fetchApi` adds the CSRF header.

---

## Shared Types

Both frontend and backend import from `src/shared/types.ts`. This file defines:

- `ChatMessage` shape (role + text + optional streaming flag)
- WebSocket message types (frontend→backend: `chat`; backend→frontend: `text_delta`, `text_done`, `error`, `conversation_updated`)
- `Conversation` — id, title, sdk_session_id, created_at, updated_at
- `ConversationWithMessages` — extends Conversation with messages array
- `ChatMessageRecord` — id, conversation_id, role, content, created_at
- API response types for REST endpoints

No build-time code generation. The shared types file is imported directly by both `src/client/` and `src/server/` since everything is TypeScript in a flat project structure.
