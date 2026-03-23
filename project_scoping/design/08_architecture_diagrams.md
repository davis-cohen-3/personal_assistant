# Architecture Diagrams

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                          │
│                                                                     │
│  ┌───────────┐  ┌──────────────┐  ┌─────────────┐                   │
│  │  Chat.tsx  │  │ BucketBoard  │  │ ThreadDetail│                   │
│  │ (WebSocket)│  │   (REST)     │  │ EventDetail │                   │
│  │           │  │              │  │   (REST)    │                   │
│  └─────┬─────┘  └──────┬───────┘  └──────┬──────┘                   │
│        │               │                │                           │
└────────┼───────────────┼────────────────┼───────────────────────────┘
         │               │                │
         │ WebSocket     │ REST /api/*    │ REST /api/*
         │               │                │                │
┌────────┼───────────────┼────────────────┼────────────────┼─────────┐
│        ▼               ▼                ▼                ▼         │
│  ┌──────────┐    ┌──────────────────────────────────────────────┐  │
│  │ agent.ts │    │                 routes.ts                    │  │
│  │ (Agent   │    │                                              │  │
│  │  SDK +   │    │  /api/gmail/*    /api/calendar/*             │  │
│  │  MCP     │    │  /api/buckets/*  /api/bucket-templates/*     │  │
│  │  tools)  │    │                                              │  │
│  └────┬─────┘    └───────────┬──────────────────────────────────┘  │
│       │                      │                                     │
│       │              ┌───────┴───────┐                             │
│       │              │   email.ts    │                             │
│       │              │ (orchestrates │                             │
│       │              │  gmail.ts +   │                             │
│       │              │  queries.ts   │                             │
│       │              │  for all      │                             │
│       │              │  email reads) │                             │
│       │              └───────┬───────┘                             │
│       │                      │                                     │
│       │    ┌─────────────────┼──────────┐                          │
│       │    │                 │           │                          │
│       ▼    ▼                 ▼           ▼                          │
│  ┌────────────────────────────┐   ┌──────────────────┐             │
│  │       google/*             │   │   db/queries.ts  │             │
│  │       connectors           │   │   (Drizzle ORM)  │             │
│  │  (shared by agent + REST)  │   │                  │             │
│  └────────────┬───────────────┘   └────────┬─────────┘             │
│               │                            │                       │
│                    Hono Backend (src/server/)                       │
└───────────────┼────────────────────────────┼───────────────────────┘
                │                            │
                ▼                            ▼
   ┌──────────────────────┐           ┌───────────┐
   │     Google APIs      │           │ Postgres  │
   │  Gmail · Calendar    │           │ 8 tables  │
   │  Drive               │           │           │
   └──────────────────────┘           └───────────┘
```

---

## 2. Agent Chat Path (WebSocket)

```
  User                    Frontend              Backend                Agent SDK            MCP Tools          Google/DB
   │                        │                     │                      │                    │                  │
   │  types message         │                     │                      │                    │                  │
   ├───────────────────────►│                     │                      │                    │                  │
   │                        │  {type:'chat',      │                      │                    │                  │
   │                        │   content:'...'}    │                      │                    │                  │
   │                        ├────────────────────►│                      │                    │                  │
   │                        │     WebSocket       │  session.chat(msg)   │                    │                  │
   │                        │                     ├─────────────────────►│                    │                  │
   │                        │                     │                      │  gmail.search()    │                  │
   │                        │                     │                      ├───────────────────►│                  │
   │                        │                     │                      │                    ├─────────────────►│
   │                        │                     │                      │                    │◄─────────────────┤
   │                        │                     │                      │◄───────────────────┤                  │
   │                        │                     │                      │                    │                  │
   │                        │                     │                      │  buckets.assign()  │                  │
   │                        │                     │                      ├───────────────────►│                  │
   │                        │                     │                      │                    ├─────────────────►│
   │                        │                     │                      │                    │◄─────────────────┤
   │                        │                     │                      │◄───────────────────┤                  │
   │                        │                     │                      │                    │                  │
   │                        │                     │  stream tokens       │                    │                  │
   │                        │  {type:'text_delta', │◄─────────────────────┤                    │                  │
   │  sees tokens typing    │   content:'...'}    │  (repeated per token)│                    │                  │
   │◄───────────────────────┤◄────────────────────┤                      │                    │                  │
   │                        │                     │  stream complete     │                    │                  │
   │                        │  {type:'text_done',  │◄─────────────────────┤                    │                  │
   │  sees final response   │   content:'...'}    │                      │                    │                  │
   │◄───────────────────────┤◄────────────────────┤                      │                    │                  │
   │                        │                     │                      │                    │                  │
   │  BucketBoard           │  GET /api/buckets   │                      │                    │                  │
   │  auto-refreshes        ├────────────────────►│                      │                    │                  │
   │  sees updated buckets  │◄────────────────────┤                      │                    │                  │
   │◄───────────────────────┤                     │                      │                    │                  │
```

---

## 3. Approval Flow (Side-Effect Operations)

Approval is chat-based — no special buttons or message types. The agent describes the action and asks for confirmation. The user replies in natural language.

```
  User                    Frontend              Backend                Agent SDK
   │                        │                     │                      │
   │  "draft a reply to     │                     │                      │
   │   Dan about pricing"   │                     │                      │
   ├───────────────────────►│                     │                      │
   │                        ├────────────────────►│                      │
   │                        │                     ├─────────────────────►│
   │                        │                     │                      │
   │                        │                     │  Agent reads thread, │
   │                        │                     │  drafts reply,       │
   │                        │                     │  describes in text   │
   │                        │                     │  + "Want me to send  │
   │                        │                     │   this?"             │
   │                        │                     │                      │
   │                        │  text_delta tokens   │◄─────────────────────┤
   │  sees draft streaming  │  streamed over WS   │                      │
   │◄───────────────────────┤◄────────────────────┤                      │
   │                        │  {type:'text_done'}  │                      │
   │◄───────────────────────┤◄────────────────────┤                      │
   │                        │                     │                      │
   │  types "go ahead"      │                     │                      │
   ├───────────────────────►│                     │                      │
   │                        │  {type:'chat',      │                      │
   │                        │   content:          │                      │
   │                        │   'go ahead'}       │                      │
   │                        ├────────────────────►│                      │
   │                        │                     ├─────────────────────►│
   │                        │                     │                      │
   │                        │                     │  Agent calls gmail   │
   │                        │                     │  send tool           │
   │                        │                     │                      │
   │                        │  text_delta tokens   │◄─────────────────────┤
   │  "Email sent to Dan."  │  + text_done        │                      │
   │◄───────────────────────┤◄────────────────────┤                      │
```

---

## 4. Direct UI Path (REST)

```
  User                    Frontend              Backend               Google APIs
   │                        │                     │                      │
   │  clicks thread card    │                     │                      │
   │  in BucketBoard        │                     │                      │
   ├───────────────────────►│                     │                      │
   │                        │  GET /api/gmail/    │                      │
   │                        │  threads/:id        │                      │
   │                        ├────────────────────►│                      │
   │                        │                     │  gmail.getThread()   │
   │                        │                     ├─────────────────────►│
   │                        │                     │◄─────────────────────┤
   │                        │  { messages: [...] }│                      │
   │  sees ThreadDetail     │◄────────────────────┤                      │
   │  panel with messages   │                     │                      │
   │◄───────────────────────┤                     │                      │
   │                        │                     │                      │
   │  types reply,          │                     │                      │
   │  clicks Send           │                     │                      │
   ├───────────────────────►│                     │                      │
   │                        │  POST /api/gmail/   │                      │
   │                        │  threads/:id/reply  │                      │
   │                        ├────────────────────►│                      │
   │                        │                     │  gmail.replyTo       │
   │                        │                     │  Thread()            │
   │                        │                     ├─────────────────────►│
   │                        │                     │◄─────────────────────┤
   │                        │  { ok: true }       │                      │
   │  reply sent            │◄────────────────────┤                      │
   │◄───────────────────────┤                     │                      │
```

---

## 5. Auth Flow

```
  User                    Frontend              Backend               Google OAuth
   │                        │                     │                      │
   │  visits app            │                     │                      │
   ├───────────────────────►│                     │                      │
   │                        │  GET /auth/status   │                      │
   │                        ├────────────────────►│                      │
   │                        │  {authenticated:    │                      │
   │                        │   false}            │                      │
   │                        │◄────────────────────┤                      │
   │                        │                     │                      │
   │  redirected to Google  │  redirect to        │                      │
   │  consent screen        │  /auth/google       │                      │
   │◄───────────────────────┤────────────────────►│                      │
   │                        │                     │  generateAuthUrl()   │
   │                        │                     ├─────────────────────►│
   │                        │                     │◄─────────────────────┤
   │  ◄──────────── redirect to Google consent ──────────────────────── │
   │                        │                     │                      │
   │  grants permissions    │                     │                      │
   │  ─────────────── redirect to /auth/google/callback ───────────────►│
   │                        │                     │◄─────────────────────┤
   │                        │                     │                      │
   │                        │                     │  1. exchange code    │
   │                        │                     │     for tokens       │
   │                        │                     │  2. get user email   │
   │                        │                     │  3. check ALLOWED_   │
   │                        │                     │     USERS            │
   │                        │                     │  4. encrypt + persist│
   │                        │                     │     tokens to Postgres│
   │                        │                     │  5. set httpOnly JWT │
   │                        │                     │     session cookie   │
   │                        │                     │                      │
   │  redirect to /         │◄────────────────────┤                      │
   │  cookie set by browser │                     │                      │
   │◄───────────────────────┤                     │                      │
```

---

## 6. Data Flow — Where State Lives

```
┌─────────────────────────────────────────────────────────────────┐
│                         Postgres (8 tables)                      │
│                                                                  │
│  ┌─────────────────┐  ┌───────────────────┐                     │
│  │ buckets         │  │ bucket_templates  │                     │
│  │                 │  │                   │                     │
│  │ id              │  │ id                │                     │
│  │ name            │  │ name              │                     │
│  │ description     │  │ description       │                     │
│  │ sort_order      │  │ buckets (jsonb)   │                     │
│  └────────┬────────┘  └───────────────────┘                     │
│           │                                                      │
│           │ FK                                                   │
│           ▼                                                      │
│  ┌─────────────────┐                                             │
│  │ thread_buckets  │                                             │
│  │                 │                                             │
│  │ id              │                                             │
│  │ gmail_thread_id │                                             │
│  │ bucket_id (FK)  │                                             │
│  │ subject         │                                             │
│  │ snippet         │                                             │
│  │ needs_rebucket  │                                             │
│  │ assigned_at     │                                             │
│  └─────────────────┘                                             │
│                                                                  │
│  ┌─────────────────┐  ┌───────────────────┐                     │
│  │ conversations    │  │ chat_messages     │                     │
│  │                 │  │                   │                     │
│  │ id              │  │ id                │                     │
│  │ title           │  │ conversation_id   │                     │
│  │ sdk_session_id  │  │ role              │                     │
│  │ created_at      │  │ content           │                     │
│  │ updated_at      │  │ created_at        │                     │
│  └─────────────────┘  └───────────────────┘                     │
│                                                                  │
│                                                                  │
│  ┌─────────────────┐  ┌───────────────────┐                     │
│  │ email_threads   │  │ email_messages    │                     │
│  │                 │  │                   │                     │
│  │ gmail_thread_id │  │ gmail_message_id  │                     │
│  │ subject         │  │ gmail_thread_id   │                     │
│  │ snippet         │  │ from_email        │                     │
│  │ from_email      │  │ body_text         │                     │
│  │ label_ids       │  │ received_at       │                     │
│  └─────────────────┘  └───────────────────┘                     │
│                                                                  │
│  ┌─────────────────┐                                             │
│  │ google_tokens   │                                             │
│  │                 │                                             │
│  │ access_token    │  ← encrypted at rest (AES-256-GCM)         │
│  │ refresh_token   │  ← encrypted at rest (AES-256-GCM)         │
│  │ expiry_date     │                                             │
│  └─────────────────┘                                             │
│                                                                  │
│  Stores: bucket definitions, thread→bucket assignments,          │
│  email cache (threads + messages for classification),            │
│  OAuth tokens, and chat history.                                 │
│  Calendar/Drive content is live from Google APIs.                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Google APIs (live data)                       │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐          │
│  │ Gmail       │  │ Calendar     │  │ Drive         │          │
│  │             │  │              │  │               │          │
│  │ threads     │  │ events       │  │ files         │          │
│  │ messages    │  │ attendees    │  │ docs content  │          │
│  │ labels      │  │ free/busy    │  │ metadata      │          │
│  └─────────────┘  └──────────────┘  └───────────────┘          │
│                                                                  │
│  Source of truth for content. Gmail threads/messages are cached   │
│  locally (email_threads + email_messages) for classification.    │
│  Calendar and Drive are fetched on demand, not cached.           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Disk (file-based state)                       │
│                                                                  │
│  ~/.claude/projects/<cwd>/<session-id>.jsonl                     │
│  (Agent SDK session files — ephemeral on GCP Cloud Run, used for       │
│   session resume. Postgres chat_messages is the durable record)  │
│                                                                  │
│  .claude/skills/*.md                                             │
│  (Agent workflow definitions — read into agent context)           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Component Tree

```
App
 │
 ├── (unauthenticated) → GoogleLoginRedirect
 │
 └── (authenticated)
      │
      ├── ConversationList                   ← GET /api/conversations
      │    │
      │    ├── [+ New Chat] button           → POST /api/conversations
      │    └── conversation items
      │         └── onClick → switches active conversation
      │
      ├── Chat (conversationId)              ← GET /api/conversations/:id (history)
      │    │                                 ← WS /ws?conversationId=xxx (full-response)
      │    ├── message stream (text only)
      │    │    └── user messages + agent responses
      │    │
      │    └── input bar
      │
      ├── BucketBoard                        ← GET /api/buckets
      │    │
      │    └── bucket columns
      │         └── thread cards
      │              └── onClick → opens ThreadDetail
      │
      ├── CalendarView                       ← GET /api/calendar/events
      │    │
      │    └── event cards (today + tomorrow)
      │         └── onClick → opens EventDetail
      │
      ├── ThreadDetail (overlay/panel)       ← GET /api/gmail/threads/:id
      │    ├── message list
      │    ├── reply composer                ← POST /api/gmail/threads/:id/reply
      │    └── [Archive]                     ← POST /api/gmail/threads/:id/archive
      │
      └── EventDetail (overlay/panel)        ← GET /api/calendar/events/:id
           ├── event info (read mode)
           ├── event form (edit mode)        ← PATCH /api/calendar/events/:id
           └── [Delete]                      ← DELETE /api/calendar/events/:id
```

---

## 8. MCP Tool Routing

```
                    Agent SDK Session
                         │
                         │ tool calls
                         ▼
              ┌─────────────────────┐
              │  In-Process MCP     │
              │  Server (tools.ts)  │
              │                     │
              │  5 tools:           │
              └──┬──────────────┬───┘
                 │              │
     ┌───────────┤              ├───────────┐
     │           │              │           │
     ▼           ▼              ▼           ▼
┌─────────┐ ┌─────────┐  ┌──────────┐ ┌──────────────┐
│ gmail   │ │calendar │  │ drive    │ │ buckets      │
│(sync_   │ │         │  │          │ │              │
│ email,  │ │         │  │          │ │              │
│ action_ │ │         │  │          │ │              │
│ email)  │ │         │  │          │ │              │
└────┬────┘ └────┬────┘  └────┬─────┘ └──────┬───────┘
     │           │            │               │
     ▼           ▼            ▼               ▼
┌─────────┐ ┌─────────┐ ┌──────────┐  ┌───────────┐
│google/  │ │google/  │ │google/   │  │db/        │
│gmail.ts │ │calendar │ │drive.ts  │  │queries.ts │
│         │ │.ts      │ │          │  │           │
└────┬────┘ └────┬────┘ └────┬─────┘  └─────┬─────┘
     │           │            │              │
     ▼           ▼            ▼              ▼
  Gmail API  Calendar API  Drive API     Postgres
```

---

## 9. First Launch Flow

```
  User                    Frontend              Backend               Postgres
   │                        │                     │                      │
   │  logs in (OAuth)       │                     │                      │
   ├───────────────────────►│                     │                      │
   │                        │                     │                      │
   │  no buckets exist      │  GET /api/buckets   │                      │
   │                        ├────────────────────►│                      │
   │                        │  { buckets: [] }    │  listBucketsWithThreads()
   │                        │◄────────────────────┤─────────────────────►│
   │                        │                     │  empty               │
   │  sees "Pick a template"│                     │◄─────────────────────┤
   │◄───────────────────────┤                     │                      │
   │                        │                     │                      │
   │                        │  GET /api/bucket-   │                      │
   │                        │  templates          │                      │
   │                        ├────────────────────►│  listBucketTemplates()
   │  sees template options │  [{name:'Executive',│─────────────────────►│
   │  (Executive, Sales,    │    ...}, ...]       │◄─────────────────────┤
   │   Engineering)         │◄────────────────────┤                      │
   │◄───────────────────────┤                     │                      │
   │                        │                     │                      │
   │  picks "Executive"     │                     │                      │
   ├───────────────────────►│                     │                      │
   │                        │  POST /api/bucket-  │                      │
   │                        │  templates/:id/apply│                      │
   │                        ├────────────────────►│  applyBucketTemplate()
   │                        │                     ├─────────────────────►│
   │                        │                     │  creates bucket rows │
   │                        │  { buckets: [...] } │◄─────────────────────┤
   │  sees BucketBoard      │◄────────────────────┤                      │
   │  (empty buckets)       │                     │                      │
   │◄───────────────────────┤                     │                      │
   │                        │                     │                      │
   │  types "Start Day"     │                     │                      │
   │  in chat               │                     │                      │
   ├───────────────────────►│                     │                      │
   │                        │  (WebSocket →       │                      │
   │                        │   Agent SDK →       │                      │
   │                        │   Morning Briefing  │                      │
   │                        │   skill →           │                      │
   │                        │   scans inbox →     │                      │
   │                        │   classifies →      │                      │
   │                        │   assigns to        │                      │
   │                        │   buckets)          │                      │
   │                        │                     │                      │
   │  sees briefing text    │                     │                      │
   │  in chat               │                     │                      │
   │◄───────────────────────┤                     │                      │
   │                        │                     │                      │
   │  BucketBoard refreshes │  GET /api/buckets   │                      │
   │  sees threads in       │◄───────────────────►│◄────────────────────►│
   │  buckets               │                     │                      │
   │◄───────────────────────┤                     │                      │
```
