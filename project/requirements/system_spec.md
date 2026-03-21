# Personal Assistant Agent — System Specification

## Overview

A conversational AI agent that acts as an executive assistant for GSuite. The user presses "Start Day" and the system autonomously scans email, calendar, and drive, then delivers a prioritized daily briefing with ready-to-approve actions. A background heartbeat (cron) continuously monitors for new items throughout the day. The user can also make ad-hoc conversational requests at any time.

Single-user per deployment. Each instance is one person's assistant.

---

## Entities

### People

Contact record with relationship context. Agent-created with `status: proposed`, user confirms or rejects.

| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| name | text | Full name |
| email | text | Primary email (unique) |
| role | text | Job title / role |
| company | text | Company or organization |
| relationship_type | enum | `colleague`, `client`, `vendor`, `reports_to_me`, `i_report_to`, `external`, `personal`, `other` |
| context | text | What you work on together, how you know them |
| notes | text | Freeform — user-written or agent-proposed observations |
| last_interaction | timestamp | Most recent thread/event involving this person |
| status | enum | `proposed`, `confirmed`, `rejected` |
| source | text | How discovered: `inbox_scan`, `calendar_event`, `user_created` |
| created_at | timestamp | |
| updated_at | timestamp | |

Interaction history is derived by querying Threads and Events by participant email — not stored on the People record.

---

### Threads

Gmail thread references. No message content stored — fetched on demand from Gmail API. Retained as long as the thread exists in Gmail.

| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| gmail_thread_id | text | Gmail API thread ID (unique) |
| subject | text | Thread subject line |
| snippet | text | Gmail snippet / preview |
| bucket_id | uuid | FK → Buckets. Exactly one bucket per thread. |
| classification | jsonb | Urgency, action_needed, category |
| last_message_at | timestamp | Most recent message timestamp |
| created_at | timestamp | |
| updated_at | timestamp | |

On initial setup, the system scans the most recent ~200 threads to seed Threads and People.

To find all threads involving a person, query Gmail API by their email address — not maintained as a local index.

---

### Buckets

User-defined categories for organizing threads. Mutually exclusive — each thread belongs to exactly one bucket. Creating a new bucket triggers re-sort of all threads.

| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| name | text | Bucket name (unique) |
| description | text | What belongs here — used by the agent for classification |
| sort_order | integer | Display order |
| created_at | timestamp | |

Default buckets seeded on setup (to be defined). User can create, rename, or remove buckets at any time.

---

### Events

Calendar event references + meeting briefs.

| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| google_event_id | text | Google Calendar event ID (unique) |
| title | text | Event title |
| start_time | timestamp | |
| end_time | timestamp | |
| event_type | enum | `one_on_one`, `group`, `external`, `recurring`, `focus_time`, `other` |
| participant_ids | jsonb | Array of People IDs (GIN indexed) |
| related_thread_ids | jsonb | Array of Thread IDs related to this event |
| documents | jsonb | Array of `{ google_doc_id, title, url }` — inline references, no separate table |
| brief | jsonb | Agent-generated meeting brief: context, related threads, related docs, participant notes |
| pre_metadata | jsonb | Known before the meeting: participant_count, event_type classification, agenda_exists |
| post_metadata | jsonb | Populated after the meeting: actual_duration, action_items_produced, follow_up_threads, notes_link, agenda_covered |
| created_at | timestamp | |
| updated_at | timestamp | |

Post-metadata is populated by the heartbeat when it detects a meeting has ended — checks for follow-up threads, notes docs, and action items.

---

### Tasks

Tracked obligations over time. Owner is always the user. Optionally delegated to a Person.

| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| title | text | What needs to be done |
| description | text | Details |
| status | enum | See status flow below |
| priority | enum | `urgent`, `high`, `normal`, `low` |
| due_date | date | |
| delegated_to | uuid | FK → People (nullable) |
| source_type | text | What created this: `thread`, `event`, `user`, `agent` |
| source_id | uuid | FK to originating entity (nullable) |
| related_documents | jsonb | Array of `{ google_doc_id, title, url }` |
| created_at | timestamp | |
| updated_at | timestamp | |

**Task status flow:**

```
proposed → confirmed → in_progress → complete_proposed → complete
                                    ↘ overdue
          ↘ rejected
```

---

### Actions

Every agent operation — proposals surface as action cards in the UI, all entries serve as audit trail.

| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| operation | text | What was done (e.g., `email.send`, `doc.create`, `thread.classify`) |
| initiated_by | enum | `agent`, `user` |
| status | enum | `proposed`, `approved`, `executed`, `rejected`, `expired`, `failed` |
| entity_type | text | What entity was affected (nullable) |
| entity_id | uuid | FK to affected entity (nullable) |
| input | jsonb | Parameters passed to the operation |
| output | jsonb | Result (nullable) |
| error | text | Error message if failed (nullable) |
| created_at | timestamp | |
| executed_at | timestamp | |

Side-effect operations start as `proposed` and surface as action cards. User approves or rejects. Read-only operations are logged as `executed` directly.

Approval/rejection history feeds into Preferences (file-based) to shape future agent behavior.

---

## Preferences (File-Based)

Learned preferences that shape how the agent works over time. Stored as files, not in the database — read into agent context at conversation start.

See [Preferences Structure](#preferences-structure) below.

---

## Operations

Atomic operations the system can perform. Operations with side effects go through the proposal/approval lifecycle. Read-only operations execute directly.

Operations can be **chained** — a higher-level operation calls lower-level ones as needed (e.g., cancelling an event sends notification emails to participants internally).

### Email

| Operation | Side Effect | Description |
|---|---|---|
| `email.read_thread` | No | Fetch full thread content from Gmail API |
| `email.classify_thread` | No | Classify thread and assign to bucket |
| `email.draft_reply` | Yes | Draft a reply — proposed for user review |
| `email.draft_new` | Yes | Draft a new email — proposed for user review |
| `email.send` | Yes | Send an approved email |

### Calendar

| Operation | Side Effect | Description |
|---|---|---|
| `calendar.read_event` | No | Fetch event details from Google Calendar API |
| `calendar.create_event` | Yes | Create a new calendar event |
| `calendar.update_event` | Yes | Update an event. Chains `email.send` to notify participants if needed. |
| `calendar.cancel_event` | Yes | Cancel an event. Chains `email.send` to notify participants. |

### Documents

| Operation | Side Effect | Description |
|---|---|---|
| `doc.find` | No | Search Drive for relevant documents |
| `doc.read` | No | Fetch document content from Drive API |
| `doc.create` | Yes | Create a new Google Doc/Sheet |
| `doc.edit` | Yes | Edit an existing document |
| `doc.share` | Yes | Share a document with a person |

### Tasks

| Operation | Side Effect | Description |
|---|---|---|
| `task.create` | Yes | Create a new task (`proposed` status by default when agent-created) |
| `task.update` | Yes | Update task details |
| `task.complete` | Yes | Mark task as complete (or propose completion) |
| `task.delegate` | Yes | Set `delegated_to` on task. Chains `email.send` for handoff. |

### People

| Operation | Side Effect | Description |
|---|---|---|
| `people.create` | Yes | Create a person record (with `proposed` status when agent-created) |
| `people.update` | Yes | Update relationship context, notes, or type |
| `people.lookup_history` | No | Query Gmail API for threads involving this person's email |

---

## Skills

Named, scoped workflows the orchestrator dispatches to subagents. Each skill runs in an isolated context window.

### Sort Inbox

**Trigger:** Start Day, or Heartbeat detects new threads.

1. Fetch recent threads from Gmail API
2. Classify each thread (urgency, action_needed, category)
3. Assign each thread to exactly one bucket
4. Create/update Thread records
5. Return sorted thread summary to orchestrator

Does not draft replies, extract tasks, or propose contacts. Those happen in downstream skills.

---

### Re-sort Inbox

**Trigger:** User creates a new bucket.

1. Load all bucket definitions including the new one
2. Re-evaluate every thread against the full bucket set
3. Reassign threads as needed
4. Return change summary

---

### Investigate Thread

**Scope:** Single thread.

**Trigger:** User clicks into a thread, orchestrator identifies a thread needing deeper analysis, or as follow-up to Sort Inbox.

1. Fetch full thread history from Gmail API
2. Extract any tasks mentioned
3. Identify people — create new Person records (`proposed` status) for unrecognized participants
4. Update relationship context for recognized participants
5. Draft reply if action is needed — proposed for user approval
6. Return investigation summary

---

### Prep Meeting

**Scope:** Single event.

**Trigger:** Start Day (once per event, in parallel), or user asks about a specific meeting.

1. Read event details from Google Calendar API
2. Look up each participant in People
3. Find related threads (query Gmail API for recent emails involving participants or matching event topic)
4. Find related documents (shared docs, agendas, prior meeting notes)
5. Generate pre-metadata (participant count, type classification)
6. Build meeting brief
7. Return brief to orchestrator

---

### Post-Meeting Processing

**Scope:** Single event.

**Trigger:** Heartbeat detects a meeting has ended.

1. Check for follow-up threads involving meeting participants
2. Check for new/updated documents (meeting notes, action items)
3. Extract action items → propose as Tasks
4. Populate post_metadata on Event record
5. Return summary to orchestrator

---

### Event Update + Notify

**Scope:** Single event.

**Trigger:** User requests a change to a calendar event.

1. Update the calendar event (chains `email.send` to notify participants)
2. Return confirmation

---

### Delegate Task

**Scope:** Single task.

**Trigger:** Agent proposes delegation, or user requests it.

1. Set `delegated_to` on the task
2. Draft handoff email with relevant context/docs — proposed for user approval
3. On approval, chains `email.send`
4. Return confirmation

---

### Daily Briefing

**Trigger:** User presses "Start Day."

1. Run **Sort Inbox** (subagent)
2. Run **Prep Meeting** per event today/tomorrow (parallel subagents, isolated per event)
3. Query Tasks due today or overdue
4. Query stale delegations
5. Render prioritized briefing:
   - Priority actions needing user now
   - Meeting briefs (chronological)
   - Tasks due / overdue
   - Delegation status
   - Follow-ups that fell through the cracks

The briefing is a **rendered view** assembled from live entity state, not a stored entity.

---

### Heartbeat

**Trigger:** Background cron, configurable frequency. Webhooks can be added later for real-time Gmail and Calendar updates.

1. Check for new emails → auto-classify and bucket (Sort Inbox logic for new items only)
2. Check for calendar event changes → update Event records, re-run Prep Meeting if significant
3. Check for ended meetings → run Post-Meeting Processing
4. Check for overdue tasks → flag them
5. Check for stale delegations → notify user
6. Check for agent-detected task completions → propose completion
7. Surface any urgent items to the user immediately

The heartbeat is the system's continuous intake mechanism. Keeps data current without the user asking.

---

## Architecture

### Orchestrator

The single persistent agent. It:
- Talks to the user (the only agent the user interacts with)
- Manages state (reads/writes all entities)
- Decides which skills to invoke and when
- Merges subagent results into coherent responses
- Handles the proposal/approval flow

### Subagents

Ephemeral workers spun up per-skill. Each gets:
- An **isolated context window** scoped to their workflow
- Only the data they need (isolation)
- Everything they need within that scope (richness)
- A defined set of operations they can call
- A return contract (what they send back to orchestrator)

Subagents do not talk to the user. They return results to the orchestrator.

### Context Management

Two rules:
1. **Isolation** — subagents never see more than their skill requires. Sort Inbox doesn't see calendar events. Prep Meeting doesn't see unrelated threads.
2. **Richness** — within their scope, subagents get everything. Prep Meeting gets full participant profiles, all related threads, all related docs.

The orchestrator's context stays clean by delegating deep work and receiving summaries.

---

## Proposal / Approval Lifecycle

Every side-effect operation follows this universal pattern:

```
proposed → approved → executed
          ↘ rejected
          ↘ expired
```

1. **Proposed** — agent recommends an action. Surfaced to user as an action card.
2. **Approved** — user approves (possibly after editing). Ready to execute.
3. **Executed** — system carries out the operation. Logged in Actions.
4. **Rejected** — user rejected. Logged. Feeds into Preferences.
5. **Expired** — no longer relevant. Auto-detected by heartbeat.

Read-only operations execute without approval.

---

## Flows

### Start Day

```
User → "Start Day"
  → Orchestrator dispatches:
      1. Sort Inbox (subagent)
      2. Prep Meeting x N (parallel subagents, one per event)
      3. Task query (direct DB read)
  → Orchestrator merges results
  → Renders daily briefing
  → User interacts via action cards + chat
```

### Heartbeat (Continuous)

```
Cron trigger (configurable frequency)
  → New emails → auto-classify + bucket
  → Calendar changes → update events
  → Ended meetings → post-meeting processing
  → Task statuses → flag overdue, propose completions
  → Delegations → flag stale
  → Urgent items → surface immediately
```

### Conversational Request

```
User → "draft a reply to Dan about the proposal"
  → Orchestrator identifies: find Dan's thread, then draft reply
  → Dispatches Investigate Thread subagent (scoped to Dan's thread)
  → Subagent returns draft reply as proposed action
  → User approves / edits / rejects
```

### New Bucket

```
User → creates a new bucket
  → Orchestrator dispatches Re-sort Inbox subagent
  → All threads re-evaluated against full bucket set
  → Threads reassigned
  → User sees updated organization
```

---

## Preferences Structure

Preferences are stored as files in a `preferences/` directory, loaded into agent context at conversation start. Not a database entity.

Organized by category:

```
preferences/
  profile.md              ← who the user is (name, email, role, company, timezone)
  communication_style.md
  scheduling.md
  priority_rules.md
  delegation.md
  general.md
```

`profile.md` holds factual user identity — the agent needs this for drafting emails, knowing which calendar/inbox to read, and setting the right tone. No database entity needed since it's single-user.

```markdown
# Profile

- Name: Davis Cohen
- Email: davis@example.com
- Role: Founder
- Company: Acme
- Timezone: America/New_York
```

The remaining files contain learned behavioral rules with source attribution:

```markdown
# Communication Style

- Keep email drafts concise, under 3 paragraphs [inferred from approvals]
- Always CC Sarah on Acme-related threads [user explicit]
- Use bullet points over prose for status updates [inferred from edits]
```

The agent updates these files when it detects patterns from approval/rejection history or when the user gives explicit instructions. Changes are proposed to the user before writing.

---

## Extensibility

GSuite-native. New integrations plug in without changing the core.

**To add a new integration (e.g., Slack, Linear, payments):**

1. **New operations** — atomic tools for the new service
2. **New entity types** (if needed) — with JSONB arrays for cross-references
3. **New skills** — workflows using the new operations

**What doesn't change:**
- Orchestrator core
- Proposal/approval lifecycle
- Actions table
- Preferences system
- Context management pattern

---

## Open Questions

1. **Default buckets** — define the seeded set.
2. **Post-meeting trigger timing** — how long after a meeting ends should the heartbeat wait before running Post-Meeting Processing? (Participants may still be writing notes.)
3. **Google AI Notetaker** — future phase integration for meeting transcripts and metadata.
