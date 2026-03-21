# UI Wireframes

## Layout

Three-column layout: a conversation sidebar on the left, a chat panel in the center, and data panels on the right. The sidebar lists past conversations with a "New Chat" button. The chat stream is text-only, scoped to the active conversation. The data panels (BucketBoard, CalendarView) live outside the chat and reflect current state from the REST API. Clicking a thread or event card opens a detail panel (ThreadDetail, EventDetail) for direct interaction.

```
┌──────────┬────────────────────────────────┬─────────────────────────────┐
│          │                                │                             │
│ SIDEBAR  │        CHAT PANEL              │       DATA PANELS           │
│          │   (text only)                  │                             │
│ [+ New]  │                               │   BucketBoard (kanban)      │
│          │                                │   CalendarView (schedule)   │
│ Convo 1  │                                │                             │
│ Convo 2  │                                │                             │
│ Convo 3  │                                │   Clicking a thread card    │
│ ...      │                                │   → opens ThreadDetail      │
│          │                                │   Clicking an event card    │
│          │                                │   → opens EventDetail       │
│          │                                │                             │
│          ├────────────────────────────────┤                             │
│          │  [ Type a message... ] [Send]  │                             │
└──────────┴────────────────────────────────┴─────────────────────────────┘
```

---

## Screen 1: Login

Shown before authentication. Google OAuth is the only login method. Users must be on the `ALLOWED_USERS` email allowlist.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                                                              │
│                                                              │
│                     Personal Assistant                       │
│                                                              │
│               ┌────────────────────────┐                     │
│               │  Sign in with Google   │                     │
│               └────────────────────────┘                     │
│                                                              │
│                                                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

If the user's email is not on the allowlist, they see:

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                     Not authorized.                          │
│              Contact the admin for access.                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Screen 2: Empty State / Start Day

First thing the user sees after login. The chat is empty. A prominent "Start Day" button in the center invites the user to begin. Clicking it sends `{ type: 'chat', content: 'Start my day' }` over the WebSocket, which triggers the Morning Briefing skill via the system prompt. The input bar is still available for ad-hoc requests.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                                                              │
│                                                              │
│                                                              │
│                     Good morning, Davis.                     │
│                                                              │
│                     ┌──────────────┐                         │
│                     │  Start Day   │                         │
│                     └──────────────┘                         │
│                                                              │
│                  or type a message below                     │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  [  Type a message...                          ] [ Send ]    │
└──────────────────────────────────────────────────────────────┘
```

---

## Screen 3: Start Day — Loading / Progress

After pressing Start Day, the agent runs the Morning Briefing skill. It sends text updates as it works. The data panels (BucketBoard, CalendarView) update as the agent writes data via tools.

```
┌────────────────────────────────┬─────────────────────────────┐
│                                │                             │
│  ASSISTANT:                    │   BucketBoard: (loading...) │
│  Starting your day...          │                             │
│                                │   CalendarView: (loading...)│
│  Scanning inbox — found 47     │                             │
│  new threads.                  │                             │
│                                │                             │
│  Classifying threads into      │                             │
│  buckets...                    │                             │
│                                │                             │
│  Prepping your 4 meetings...   │                             │
│                                │                             │
│                                │                             │
├────────────────────────────────┤                             │
│  [ Type a message... ] [Send]  │                             │
└────────────────────────────────┴─────────────────────────────┘
```

---

## Screen 4: Daily Briefing

The briefing is plain text sent by the agent. The data panels on the right update as the agent writes data (bucket assignments). The agent summarizes what it found and what needs attention.

```
┌────────────────────────────────┬─────────────────────────────┐
│                                │                             │
│  ASSISTANT:                    │  ┌─ BucketBoard ──────────┐ │
│  Here's your morning briefing  │  │ Needs Response (3)     │ │
│  for Thursday, Mar 20.         │  │  • Dan Chen — contract │ │
│                                │  │  • Sarah — PTO request │ │
│  PRIORITY ACTIONS:             │  │  • Mike — Q1 budget    │ │
│  - Reply to Dan Chen —         │  │                        │ │
│    contract terms. Waiting     │  │ FYI (5)                │ │
│    since yesterday, needs      │  │  • All-hands recap     │ │
│    confirmation by EOD.        │  │  • Design review notes │ │
│  - Confirm PTO for next Fri.   │  │  • ...                 │ │
│    Sarah needs your sign-off.  │  │                        │ │
│  - Review Q1 budget doc.       │  │ Waiting On (2)         │ │
│    Meeting about this at 2pm.  │  │  • Jordan — hiring     │ │
│                                │  │  • ...                 │ │
│  TODAY'S SCHEDULE:             │  └────────────────────────┘ │
│  - 9:00 Team standup           │                             │
│    (Sarah, Mike, Jordan)       │  ┌─ CalendarView ─────────┐ │
│  - 11:00 1:1 with Dan Chen     │  │ 9:00  Team standup     │ │
│    Re: Acme contract pricing   │  │ 11:00 1:1 Dan Chen     │ │
│  - 2:00 Q1 Budget Review       │  │ 2:00  Q1 Budget Review │ │
│    (Mike, Sarah, Finance)      │  │ 4:30  Focus time       │ │
│  - 4:30 Focus time (blocked)   │  └────────────────────────┘ │
│                                │                             │
│  INBOX SUMMARY:                │                             │
│  47 threads scanned, 12 new.   │                             │
│  Needs Response: 3             │                             │
│  FYI: 5, Waiting On: 2        │                             │
│                                │                             │
│  Your most urgent item is the  │                             │
│  reply to Dan about contract   │                             │
│  terms — want me to draft      │                             │
│  that now?                     │                             │
│                                │                             │
├────────────────────────────────┤                             │
│  [ Type a message... ] [Send]  │                             │
└────────────────────────────────┴─────────────────────────────┘
```

---

## Panel: BucketBoard (Persistent Data Panel)

Always visible in the right-side data panel area. Kanban-style columns. Fetches from `GET /api/buckets`. Refetches after own mutations and when an agent response completes (`text_done` triggers `onAgentDone`). Clicking a thread card opens ThreadDetail.

```
┌─ INBOX ────────────────────────────────────────────────────┐
│                                                             │
│ ┌─ Needs Response ─┐ ┌─ FYI ──────────┐ ┌─ Waiting On ──┐ │
│ │                   │ │                │ │                │ │
│ │ ┌───────────────┐ │ │ ┌────────────┐ │ │ ┌────────────┐ │ │
│ │ │ Dan Chen      │ │ │ │ All-hands  │ │ │ │ Jordan Lee │ │ │
│ │ │ Re: Contract  │ │ │ │ recap      │ │ │ │ Hiring plan│ │ │
│ │ │ terms         │ │ │ │ Mar 19     │ │ │ │ follow-up  │ │ │
│ │ │ 2h ago        │ │ │ └────────────┘ │ │ │ 3d ago     │ │ │
│ │ └───────────────┘ │ │                │ │ └────────────┘ │ │
│ │ ┌───────────────┐ │ │ ┌────────────┐ │ │                │ │
│ │ │ Sarah Park    │ │ │ │ Design     │ │ │                │ │
│ │ │ PTO approval  │ │ │ │ review     │ │ │                │ │
│ │ │ request       │ │ │ │ notes      │ │ │                │ │
│ │ │ 5h ago        │ │ │ │ Mar 19     │ │ │                │ │
│ │ └───────────────┘ │ │ └────────────┘ │ │                │ │
│ │                   │ │                │ │                │ │
│ │ ┌───────────────┐ │ │ ┌────────────┐ │ │                │ │
│ │ │ Mike Torres   │ │ │ │ Newsletter │ │ │                │ │
│ │ │ Q1 budget     │ │ │ │ from SaaS  │ │ │                │ │
│ │ │ questions     │ │ │ │ Weekly     │ │ │                │ │
│ │ │ 1d ago        │ │ │ │ Mar 18     │ │ │                │ │
│ │ └───────────────┘ │ │ └────────────┘ │ │                │ │
│ └───────────────────┘ └────────────────┘ └────────────────┘ │
│                                                             │
│ ┌─ Low Priority ───┐                                        │
│ │  (empty)          │                                        │
│ └───────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Chat: EmailDraft + Approval

When the agent drafts an email, it describes the draft in plain text. The user reviews the draft and confirms by typing a response (e.g., "send it", "go ahead", "looks good"). No special buttons — approval is a normal chat exchange.

```
┌────────────────────────────────┐
│                                │
│  ASSISTANT:                    │
│  Here's a draft reply to Dan   │
│  about the contract:           │
│                                │
│  To: dan.chen@acme.co          │
│  CC: sarah@company.com         │
│  Re: Acme Contract — Pricing   │
│                                │
│  Hi Dan,                       │
│                                │
│  Confirmed — we're good with   │
│  the pricing as outlined in    │
│  v3. I've attached the signed  │
│  term sheet. Let me know if    │
│  you need anything else before │
│  we kick off.                  │
│                                │
│  Best,                         │
│  Davis                         │
│                                │
│  Want me to send this?         │
│                                │
├────────────────────────────────┤
│  [ Type a message... ] [Send]  │
└────────────────────────────────┘
```

---

## Panel: CalendarView (Persistent Data Panel)

Always visible in the right-side data panel area. Fetches from `GET /api/calendar/events`. Shows today's events (and optionally tomorrow's). Clicking an event card opens EventDetail. Refetches after own mutations and when an agent response completes (`text_done` triggers `onAgentDone`).

```
┌─ TODAY'S CALENDAR ─────────────────────────────────────────┐
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  9:00 – 9:30   Team standup (recurring)              │   │
│  │                 Sarah, Mike, Jordan                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  11:00 – 11:30  1:1 with Dan Chen                    │   │
│  │                 dan.chen@acme.co                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  2:00 – 3:00   Q1 Budget Review                      │   │
│  │                 Mike, Sarah, Finance team             │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  4:30 – 5:30   Focus time (blocked)                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Chat: ConfirmAction (Non-Email)

For non-email side-effect actions (calendar changes, etc.), the agent describes the action in text and asks the user to confirm in chat.

```
┌────────────────────────────────┐
│                                │
│  ASSISTANT:                    │
│  I'd like to create a calendar │
│  event:                        │
│                                │
│  "Q2 Planning Kickoff"         │
│  Mon Mar 24, 10:00–11:00 AM   │
│  Participants: Sarah, Mike,    │
│  Jordan                        │
│                                │
│  Should I go ahead and create  │
│  this?                         │
│                                │
├────────────────────────────────┤
│  [ Type a message... ] [Send]  │
└────────────────────────────────┘
```

---

## Conversation Flow: Ad-Hoc Request

The user types a request, the agent responds with plain text. If the agent proposes a side-effect action, it asks for confirmation in text and the user replies in chat.

```
┌────────────────────────────────┐
│                                │
│  ... (earlier messages) ...    │
│                                │
│  USER:                         │
│  when did I last talk to       │
│  Jordan about the hiring plan? │
│                                │
│  ASSISTANT:                    │
│  Your last thread with Jordan  │
│  about hiring was March 17 —   │
│  "Re: Engineering Hiring Plan  │
│  Q2." He asked for headcount   │
│  numbers and you said you'd    │
│  get back to him. No reply     │
│  since then (3 days ago).      │
│                                │
│  Want me to draft a follow-up? │
│                                │
│  USER:                         │
│  yeah, tell him we're approved │
│  for 2 backend and 1 frontend  │
│                                │
│  ASSISTANT:                    │
│  Here's a draft reply:         │
│                                │
│  To: jordan@company.com        │
│  Re: Engineering Hiring Plan Q2│
│                                │
│  Hey Jordan,                   │
│                                │
│  Good news — we're approved    │
│  for 3 hires this quarter:     │
│  2 backend engineers and 1     │
│  frontend. Let's sync on job   │
│  descriptions and timeline.    │
│                                │
│  Davis                         │
│                                │
│  Want me to send this?         │
│                                │
├────────────────────────────────┤
│  [ Type a message... ] [Send]  │
└────────────────────────────────┘
```

---

## Post-Action Confirmation

After the user confirms an action in chat, the agent executes and confirms in text.

```
│  ASSISTANT:                    │
│  Done — email sent to Dan.     │
│                                │

---

## Rejected Action

When the user declines in chat (e.g., "no", "skip that", "don't send"), the agent acknowledges in text.

```
│  ASSISTANT:                    │
│  Got it — email not sent. Want │
│  me to revise the draft, or    │
│  would you rather handle this  │
│  one yourself?                 │
│                                │

---

## Error State

Errors appear as system messages in the chat panel.

```
│  SYSTEM:                       │
│  Failed to send email — your   │
│  Google connection may have    │
│  expired.                      │
│  [Reconnect Google]            │
│                                │

---

## Panel: ThreadDetail (Direct UI)

Opens when the user clicks a thread card in BucketBoard. Fetches the full thread via REST API — no agent involved. User can read messages and reply directly.

```
┌─ THREAD ──────────────────────────────────────────────────────┐
│                                                     [ ✕ Close]│
│  Re: Acme Contract — Pricing Confirmation                     │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  Dan Chen <dan.chen@acme.co>             Mar 19, 2:14p │   │
│  │                                                        │   │
│  │  Hi Davis,                                             │   │
│  │                                                        │   │
│  │  Following up on pricing — can you confirm we're       │   │
│  │  aligned on the rates in v3? Need to get sign-off      │   │
│  │  from our finance team by EOD.                         │   │
│  │                                                        │   │
│  │  Thanks,                                               │   │
│  │  Dan                                                   │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                                                        │   │
│  │  [  Type your reply...                                ]│   │
│  │                                                        │   │
│  │                                                        │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                               │
│           [ Send Reply ]          [ Archive ]                 │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## Panel: EventDetail (Direct UI)

Opens when the user clicks an event card in CalendarView. Fetches the event via REST API. User can edit fields and save, or delete the event.

```
┌─ EVENT ───────────────────────────────────────────────────────┐
│                                                     [ ✕ Close]│
│                                                               │
│  1:1 with Dan Chen                                  [ Edit ]  │
│                                                               │
│  📅  Today, 11:00 AM – 11:30 AM                               │
│  📍  Zoom (link)                                               │
│                                                               │
│  ── Attendees ────────────────────────────────────────        │
│  Dan Chen <dan.chen@acme.co>                                  │
│  Davis Cohen (organizer)                                      │
│                                                               │
│  ── Description ──────────────────────────────────────        │
│  Discuss Acme contract pricing and timeline.                  │
│                                                               │
│                                                               │
│                              [ Delete Event ]                 │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

Edit mode (after clicking Edit):

```
┌─ EVENT (EDITING) ─────────────────────────────────────────────┐
│                                                     [ ✕ Close]│
│                                                               │
│  Title:  [ 1:1 with Dan Chen                    ]             │
│                                                               │
│  Start:  [ 2026-03-21T11:00 ]                                 │
│  End:    [ 2026-03-21T11:30 ]                                 │
│                                                               │
│  Location: [ Zoom                               ]             │
│                                                               │
│  Attendees: [ dan.chen@acme.co                  ] [+ Add]     │
│                                                               │
│  Description:                                                 │
│  [ Discuss Acme contract pricing and timeline.  ]             │
│                                                               │
│                     [ Save ]     [ Cancel ]                   │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## Design Notes

1. **Three-column layout** — Conversation sidebar on the far left (list of past chats + "New Chat" button). Chat panel in the center (text only). Data panels on the right (BucketBoard, CalendarView). Detail panels (ThreadDetail, EventDetail) open on click from data panels — all direct REST, no agent round-trip.

2. **Agent is text-only** — The agent never renders UI components. It writes data via tools (bucket assignments), and the data panels reflect changes by refetching from the REST API.

3. **Data panel refresh** — When an agent response completes (`text_done`), the Chat component calls `onAgentDone()` which triggers `refetch()` on all active data hooks. No server-side event bus — the `text_done` message is the only cross-path invalidation signal.

4. **Token-by-token streaming** — Agent text streams over WebSocket as `text_delta` messages. Frontend accumulates deltas into the current assistant message, showing a real-time typing effect. Stream ends with a `text_done` message containing the full response.

5. **Approve/reject** — Chat-based. Agent describes the proposed action and asks for confirmation. User replies in natural language ("go ahead", "send it", "no"). No special buttons — approval is a normal chat exchange.

6. **Mobile** — Mobile layout is out of scope for v1. The app targets desktop-width screens only.
