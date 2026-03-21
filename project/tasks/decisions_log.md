# Decisions Log

All architectural and design decisions with rationale. Coding agents should treat these as settled — do not re-decide.

---

## Data Model

| Decision | Rationale |
|---|---|
| Single-user per deployment, no user_id FK | Each instance is one person's assistant. Simplifies everything. |
| Postgres with JSONB | Relational model is simple, JSONB gives flexibility for classifications/metadata/documents. |
| No local content storage | Thread/event/doc content lives in Google APIs. We store references, metadata, and agent classifications. |
| Merged Relationships into People | Single-user means 1:1 relationship per person. Separate table added joins with no benefit. |
| No Documents table | Doc references always accessed through Events or Tasks. Inline `{ google_doc_id, title, url }` in JSONB. |
| No Meeting Analytics table | Computed on demand from Event metadata. Pre-aggregating is premature at single-user scale. |
| Interaction history derived, not stored | Query Threads and Events by participant email instead of maintaining a timeline JSONB array. Avoids sync problems. |
| Threads table keeps agent metadata only | Gmail API handles content and search. Threads table stores bucket assignment, classification — the agent's value-add. |
| Query Gmail by email for person's threads | Don't maintain local participant→thread index. Gmail search is purpose-built for this. |
| GIN index on Events.participant_ids | Events.participant_ids stays as JSONB array (Calendar API lacks Gmail's search). GIN index for efficient lookup. |
| Split Event metadata into pre/post | pre_metadata: known before meeting. post_metadata: populated after meeting ends by heartbeat. |
| Actions table (formerly Tool Call Log) | Every agent operation. Proposals surface as action cards. All entries serve as audit trail. No separate Actions entity needed. |
| Tasks vs Actions separation | Tasks = obligations tracked over time. Actions = agent operations with approval gate. Different lifecycle, different UI treatment. |

## Tech Stack

| Decision | Rationale |
|---|---|
| TypeScript on Node.js 20 LTS | Single language across backend, frontend, and agent code. Shared types eliminate cross-language sync friction. |
| Hono for backend API | Lightweight, TypeScript-first. Backend stays independent of frontend for future MCP/plugin exposure. |
| Drizzle ORM | Schema-as-TypeScript gives type safety. SQL-like builder works well with Postgres-specific features (JSONB, GIN, advisory locks). |
| React via Vite + React Router (not Next.js) | SPA is sufficient — no SSR/SEO needed for single-user app. Vite is simpler, Next.js adds unnecessary weight. |
| Claude Agent SDK (TypeScript) | Prescribed agent framework. Orchestrator as long-lived instance, subagents as ephemeral instances. |
| node-cron for heartbeat | Single recurring job in single-process app. No need for Redis or a job queue. Advisory lock prevents overlap. |
| googleapis for OAuth + API | Already needed for GSuite APIs. Handles OAuth flow, token refresh, offline access. No second auth library needed. |
| pnpm workspaces monorepo | Three packages: backend, frontend, shared. Clean boundaries, shared types, independent deployability. |

## Architecture

| Decision | Rationale |
|---|---|
| Preferences as files, not DB | Read frequently, written rarely, no relational queries, human-readable/editable. Loaded into agent context at start. |
| User profile in preferences/profile.md | Single-user — no DB entity needed. Agent needs name/email/role/timezone for context. |
| Heartbeat via cron (not webhooks) | Simpler to start. Webhooks can be added later for real-time updates. |
| Agent-proposes, human-confirms | Universal pattern across People, Tasks, Actions, delegation. Trust earned incrementally. |
| Orchestrator + ephemeral subagents | Orchestrator stays clean by delegating deep work. Subagents get isolated context with only what they need. |
| Core handles zero LLM work | `core/` is pure data operations (connectors + persistence). All LLM-driven work (classification, brief generation, message drafting, completion detection) lives in `agents/`. Prevents circular dependency: `agents/ → core/ → db/`. |
| Connectors as singletons | Module-level singletons initialized at startup. Imported directly by any layer that needs them — no parameter passing. Simpler than dependency injection for single-user app. |
| No dry run mode | Test suite provides sufficient coverage. Dry run would add complexity to every connector and action for a rarely-used feature. |
| Agent routes separate from core routes | `routes/agent.ts` imports from `agents/` for chat, start-day, and other LLM-driven endpoints. All other routes import from `core/` only. |
| Resolve orphaned participants from calendar | When a soft-deleted person appears in `events.participant_ids`, resolve name/email from the original Google Calendar event rather than showing "unknown." |
| Briefing response returns IDs, not full objects | `GET /api/briefings/today` returns the stored `BriefingContent` JSONB (IDs + summaries). Frontend fetches full entity details via their respective endpoints when user drills in. Avoids expensive hydration on every briefing load. |
| WebSocket auth via session cookie | Same-origin cookie validated on connection upgrade. No separate token mechanism needed for single-user app. |
