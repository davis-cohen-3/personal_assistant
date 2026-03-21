# System Overview

## What It Is

A single-user personal AI assistant that integrates with Google Workspace (Gmail, Calendar, Drive) through a conversational web interface. The agent reads your email, calendar, and drive via MCP tools and returns text responses while the frontend renders rich UI components (bucket boards, email drafts, calendar views, action confirmations).

Built on the Claude Agent SDK with a Hono backend, React frontend, and Postgres for persistence.

---

## How the Pieces Connect

```
┌─────────────────────────────────────────────────────────┐
│                      Browser (React SPA)                │
│                                                         │
│  Chat.tsx (agent text, chat-based approval)             │
│  BucketBoard.tsx, CalendarView.tsx                      │
│  (data panels, via REST)                                │
│  ThreadDetail.tsx, EventDetail.tsx (detail panels)      │
└──────────────┬─────────────────────┬────────────────────┘
               │ WebSocket           │ REST (/api/*)
               │ (agent chat)        │ (direct UI)
               ▼                     ▼
┌──────────────────────────────────────────────────────────┐
│                   Hono Backend (src/server/)             │
│                                                         │
│  index.ts ─── WebSocket route ──→ agent.ts              │
│           │                       (Agent SDK session)    │
│           │── routes.ts (REST API for direct UI actions) │
│           └── auth.ts (Google OAuth + email allowlist)   │
│                                                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │         Single In-Process MCP Server               │  │
│  │                                                    │  │
│  │  Google connectors:     Data tools:                │  │
│  │  • gmail                • buckets                  │  │
│  │  • calendar                                        │  │
│  │  • drive                                           │  │
│  │       │                        │                   │  │
│  │       ▼                        ▼                   │  │
│  │  google/* connectors      Postgres (Drizzle)       │  │
│  │  (googleapis)                                      │  │
│  │       │                                            │  │
│  │       ▼                                            │  │
│  │  Google Workspace APIs                             │  │
│  └────────────────────────────────────────────────────┘  │
│                                                         │
│  routes.ts also calls google/* connectors directly       │
│  (no agent round-trip for user-initiated actions)        │
└──────────────────────────────────────────────────────────┘
```

---

## Data Flow: Typical User Interaction

### Agent Path: "Sort my inbox into buckets"

```
1. User types message in Chat.tsx
2. Frontend sends message over WebSocket to Hono backend
3. Backend routes to Agent SDK session (agent.ts)
4. Agent reads current buckets via buckets tool (→ Postgres)
5. Agent reads inbox via gmail tool (→ google/gmail.ts → Gmail API)
6. Agent assigns threads to buckets via buckets tool (→ Postgres)
7. Agent returns text: "I've sorted 24 threads into your 5 buckets"
8. Backend streams tokens over WebSocket to frontend as they arrive
9. BucketBoard component fetches updated data from GET /api/buckets and re-renders
```

### Agent Path: User approves a proposed action (e.g., send email draft)

```
1. Agent describes proposed action in text: "I'd like to send this reply to Dan... Want me to send this?"
2. User types confirmation in chat (e.g., "go ahead", "yes", "send it")
3. Frontend sends { type: 'chat', content: 'go ahead' } over WebSocket
4. Agent executes the action via gmail tool (→ google/gmail.ts → Gmail API)
5. Agent returns confirmation text: "Email sent to Dan."
```

### Direct UI Path: User clicks a thread card and replies

```
1. User clicks thread card in BucketBoard
2. Frontend opens ThreadDetail, fetches GET /api/gmail/threads/:id
3. User types a reply, clicks Send
4. Frontend calls POST /api/gmail/threads/:id/reply
5. Backend routes.ts calls google/gmail.ts directly (no agent)
6. Response returned, UI updated
```

---

## v1 Scope

The full product vision is in `requirements/` (product_overview.md, system_spec.md, data_model.md). This design implements a focused v1 that covers the core loop: inbox classification, calendar awareness, and direct email/event interaction.

### What's in v1

- **Inbox classification** — Agent sorts threads into buckets via LLM. User picks a starter bucket template on first launch, and can create/edit custom buckets and trigger re-classification.
- **Email interaction** — View threads, reply, archive (direct UI). Agent can draft replies (chat path).
- **Calendar** — View events, edit, create, delete (direct UI). Agent can prep meetings (chat path).
- **Drive** — Search files, read Google Docs (agent-driven, read-only).
- **Daily briefing** — Agent-generated on request (Morning Briefing skill).
- **Approval flow** — Side-effect operations (send email, create event) require user approval via chat confirmation. The agent describes the action and asks for confirmation; the user replies in natural language. No special buttons or protocol — approval is a normal chat exchange.

### What's deferred to v2

| Deferred | Why |
|---|---|
| People / contact discovery | Additive enrichment layer; core inbox + calendar loop works without it |
| Heartbeat / background cron | Requires infra complexity; user-initiated is fine for v1 |
| Events table (stored briefs, pre/post metadata) | Read live from Calendar API — no persistence needed yet |
| Briefings table | Agent generates on-the-fly, not stored |
| Preferences system (learned rules) | Useful but not essential for core loop |
| Post-meeting processing | Requires Heartbeat |
| Deep-Dive / Investigate Thread skill | Nice-to-have, not core |
| Adapter pattern (pluggable providers) | Only one provider (Google) for now |

### What's out of scope (not planned)

| Removed | Why |
|---|---|
| Tasks entity | User manages tasks in their own system |
| Delegation workflow | Requires Tasks entity |
| Actions entity (audit trail) | Conversation IS the approval record |

---

## Key Design Principles

1. **Dual interaction paths** — Agent chat for intelligence (classification, drafting, triage). Direct REST API for explicit user actions (reply, edit event). Both share the same `google/*` connectors.
2. **In-process Google connectors** — Thin wrappers around the official `googleapis` package. No external MCP subprocess. See `07_google_connectors.md`.
3. **Conversation as approval queue** — No Actions table. The agent proposes side-effect operations in text, user confirms or declines in chat. The agent does not render dynamic UI components — it writes data, and the frontend renders from current state.
4. **Minimal persistence** — 8 Postgres tables (buckets, bucket_templates, thread_buckets, email_threads, email_messages, google_tokens, conversations, chat_messages). Email threads/messages are cached locally for classification; calendar/drive content is derived from APIs at query time; chat history is persisted for UI display and conversation continuity.
5. **Single-user** — No user_id columns, no multi-tenancy. One deployment = one person's assistant.
