# Data Model & Product Flow — Working Draft

## Product Flow

### Start Day

1. User hits **"Start Day"** in the web app.
2. The Lead Orchestrator dispatches the **Inbox Agent**, **Calendar Agent**, and **Drive Agent** in parallel.
3. Agents fetch live data from Gmail, Google Calendar, and Google Drive via APIs — no content is stored locally, only references and metadata.
4. Results flow back to the Orchestrator, which merges them into a **Briefing**.

### Inbox Agent

- Pulls most recent Gmail threads.
- Classifies each thread: urgency, whether it needs the user specifically, whether action is required.
- Identifies unique people across threads.
- Proposes new **People** records ("these look like real contacts in your network") — user confirms or rejects.
- Extracts potential **Tasks** ("looks like you promised Dan the report by Friday") — proposed, awaiting user confirmation.
- On initial setup: seeds People from unique contacts across the most recent ~200 threads, filtered through the agent-proposes/human-confirms flow.

### Calendar Agent

- Pulls today's and tomorrow's events (stored as references in the **Events** table).
- Cross-references participants against the **People** table.
- Finds related threads from the Inbox Agent's results.
- Attaches relevant docs surfaced by the Drive Agent.
- Builds a meeting brief for each event.

### Drive Agent

- Scans for recently shared or modified docs relevant to today's meetings or active tasks.
- Can create new docs (meeting notes templates, etc.) — but only as a proposed **Action**, pending user approval.

### Deep-Dive Agent

- A multi-purpose utility agent with its own context window.
- Any other agent can invoke it when they need to go deeper: read a full thread history, summarize a long document, cross-reference multiple sources.
- Does the work in isolation, returns a summary back to the calling agent / orchestrator.
- Keeps the orchestrator's context window clean.

### The Daily Briefing

The Orchestrator merges all agent results into a Briefing containing:

- **Priority actions** needing the user now (with draft responses as pending Actions)
- **Meeting briefings** with participant context, related threads, and relevant docs
- **Tasks due today** or overdue
- **Delegation suggestions**
- **Follow-ups** that fell through the cracks

The Briefing is saved as a record. Each item links back to underlying Actions, Tasks, Threads, and Events.

### User Interaction

- **Action cards** — approve, reject, or edit each proposed item
- **Conversational** — chat with the agent for ad-hoc requests ("draft a reply to Dan," "push that task to next week," "what's the context on the Acme thread?")
- Both modes coexist in the same UI

### Heartbeat (Cron)

A background cron job that runs throughout the day, checking for:

- New high-priority emails → surfaces proactively
- Calendar event changes → updates meeting briefs
- Task status changes → agent proposes completion ("this looks done"), user confirms
- Overdue tasks → flags them
- Delegated tasks without acknowledgment after X time → nudges the user

### Delegations

1. Agent proposes "delegate X to Sarah" (an Action)
2. User approves
3. Becomes a Task assigned to Sarah — the handoff is the key step (e.g., email drafted and sent)
4. Sarah acknowledges → task is active on her end
5. Monitoring: for now, the Heartbeat flags unacknowledged or stale delegated tasks. User decides next step. Auto-monitoring can get smarter over time.

---

## Data Model

### Entities

| Entity | Purpose |
|---|---|
| **People** | Confirmed contacts in the user's network. Agent-proposed, human-confirmed. |
| **Threads** | Gmail thread references — ID, metadata, classification. No message content stored. |
| **Events** | Calendar event references + meeting briefs. |
| **Tasks** | Tracked obligations over time. Can be owned by user or delegated to someone else. |
| **Actions** | One-shot agent proposals (draft reply, create doc, delegate, etc.). |
| **Briefings** | Daily output artifacts that aggregate and link to Tasks, Actions, Threads, Events. |
| **Preferences** | Learned patterns from the user's approve/reject history, shaping future behavior. |

Plus join tables for many-to-many relationships (People↔Threads, People↔Events).

### Task Status Flow

```
proposed → confirmed → in_progress → complete_proposed → complete
                                   ↘ overdue
           ↘ rejected
```

- **proposed** — agent extracted this from an email/meeting, awaiting user confirmation
- **confirmed** — user confirmed this is a real task
- **in_progress** — actively being worked on
- **complete_proposed** — agent detected completion signals, awaiting user confirmation
- **complete** — user confirmed done
- **overdue** — past due date, flagged by Heartbeat
- **rejected** — user rejected the proposal

### Action Status Flow

```
pending → approved → executed
        ↘ rejected
        ↘ expired
```

- **pending** — agent proposed this, awaiting user decision
- **approved** — user approved, ready to execute
- **executed** — action was carried out
- **rejected** — user rejected
- **expired** — no longer relevant (e.g., meeting already happened)

### Key Relationships

- **People ↔ Threads** — many-to-many (a thread has multiple participants, a person appears in many threads)
- **People ↔ Events** — many-to-many (same pattern for calendar events)
- **People ↔ Tasks** — a task has an owner (the user) and optionally a counterparty or delegate
- **Tasks ↔ Actions** — an action can fulfill a task
- **Tasks ↔ Threads** — a task can originate from a thread
- **Actions → Threads/Events** — an action references what triggered it
- **Briefings → Actions/Tasks/Threads/Events** — a briefing aggregates from all of these

### What We're Not Storing

- Full email message content (fetch on demand from Gmail API)
- Full document content (fetch on demand from Drive API)
- A separate Activities/interaction log table (derive interaction history by querying across Threads, Events, and Actions)

---

## Design Decisions

- **Single-user per deployment** — each instance is one person's assistant. No user_id FK. Anyone can fork and run their own.
- **Postgres** — preferred for JSONB flexibility and the simple relational model this project needs. GCP-managed alternative acceptable.
- **Agent-proposes, human-confirms** — consistent pattern across People, Tasks, Actions, and delegation. Trust is earned incrementally.
- **No local content storage** — thread/event/doc content lives in Google's APIs. We store references, metadata, and the agent's classifications.
- **Web app first** — React app using Claude Agent SDK. The agent architecture should be decoupled enough to later expose as an MCP/Skills plugin.

---

## Open Questions

- Exact schema design (column-level) — to be refined after end-user flow and requirements are fully clarified
- Preferences table structure — key-value with JSONB vs. more structured rules
- Briefing storage format — how to persist the structured sections and their links back to source entities
- Documents table — may not be needed as a standalone table; Drive doc references might live as metadata on Actions or Events
