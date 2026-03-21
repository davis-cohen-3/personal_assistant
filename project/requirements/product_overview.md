# The Personal Assistant Agent — High-Level Overview

## What It Is

A conversational AI agent that acts as your executive assistant. You press **"Start Day"** and it autonomously scans your email, calendar, and drive — then delivers a prioritized daily briefing with ready-to-approve actions. After the briefing, it stays available for follow-up requests throughout the day.

## How It Works

A **Lead Orchestrator** receives your intent (either "Start Day" or a conversational request) and dispatches specialized worker agents in parallel:

- **Inbox Agent** — Fetches and classifies recent email threads by urgency and action-needed. Identifies what needs you specifically vs. what can be delegated or ignored.
- **Calendar Agent** — Scans today and tomorrow's events. For each meeting, gathers attendee context, related email threads, and relevant docs to build a briefing.
- **Drive Agent** — Reads, creates, and edits Google Docs/Sheets. Finds relevant documents, generates meeting notes templates, attaches files to outbound drafts.
- **Deep-Dive Agent** — Triggered on-demand when any other agent needs to go deeper: read a full thread history, summarize a long document, or synthesize across multiple sources.

All agents feed their results back to the Orchestrator, which merges everything into a unified output.

## What It Produces

### The Daily Briefing
- Priority actions that need you now (with draft responses ready)
- Meeting briefings (who, context, what you need to know going in)
- Commitments and deadlines due today
- Delegation suggestions (things someone else should handle)
- Follow-ups that fell through the cracks

### Ongoing Throughout the Day
- Conversational requests — "draft a reply to Dan," "create a meeting notes doc for the 2pm," "when did I last talk to Acme?"
- A background **Heartbeat** process that monitors for new high-priority items and surfaces them proactively

## The Three Layers

| Layer | Role |
|---|---|
| **Awareness** | Connected to Inbox, Calendar, and Drive — sees everything across your tools |
| **Intelligence** | Connects dots across tools, tracks people and commitments, prioritizes by urgency and context |
| **Action** | Drafts emails, creates docs, proposes schedule changes, suggests delegations — all human-approved before execution |

## The Data Layer (to be designed)

Underneath all of this sits a unified data layer that the agents read from and write to. It stores:
- **People** — contacts enriched passively from every email, meeting, and doc interaction
- **Commitments** — promises made and owed, extracted from emails and meetings, tracked to completion
- **Activity history** — a log of interactions across tools, queryable by person, project, or time
- **User preferences** — learned patterns from accepted/rejected suggestions that shape future behavior

## Key Design Principles

1. **Opinionated by default, trainable over time** — works well on day one, gets better as you use it
2. **Human-in-the-loop always** — proposes actions, never executes without approval (trust is earned incrementally)
3. **Cross-tool synthesis over single-tool summaries** — the value is connecting your 2pm meeting to the email Dan sent last night, not just listing either one
4. **Proactive, not just reactive** — the agent notices things before you ask

## Delivery Surface

- **Web app** (React) — the primary UI with chat interface and action cards
- **Claude plugin** (MCP + Skills) — same agent capabilities accessible natively inside Claude
