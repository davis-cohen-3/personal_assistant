# Decisions Log

All architectural and design decisions with rationale. Coding agents should treat these as settled — do not re-decide.

---

## Data Model

| Decision | Rationale |
|---|---|
| Single-user per deployment, no user_id FK | Each instance is one person's assistant. Simplifies everything. |
| Postgres with JSONB | Relational model is simple, JSONB gives flexibility for classifications/metadata/documents. |
| Local email storage for classification | `email_threads` + `email_messages` cache Gmail data in Postgres. Enables re-bucketing from cached content, new-message detection via DB diff, and batch classification without repeated API calls. Calendar/Drive content still lives in Google APIs. |
| People/contacts deferred to v2 | Additive enrichment layer (contact discovery, participant context). Core inbox triage + calendar loop works without it. Avoids a full entity lifecycle (propose → confirm/reject) in v1. |
| No Documents table | Doc references accessed through Google Drive API. No local storage needed. |
| Interaction history derived, not stored | Query Gmail by participant email instead of maintaining a local index. Gmail search is purpose-built for this. |
| Thread-bucket join table stores agent metadata only | `thread_buckets` stores bucket assignment + `needs_rebucket` flag for re-evaluation. `email_threads` is the source of truth for "known threads" — anything not in it is new. |
| Batch-enforced bucketing (max 25) | Agent processes threads in batches of 25, enforced at both skill instruction and tool level. Prevents context window overload and timeouts on large inboxes. |
| Re-bucket on new bucket creation | When a new bucket is created, all existing thread_buckets rows are marked `needs_rebucket = true`. Agent re-evaluates in batches using cached email content. |
| Concurrency: last-write-wins via upsert | Multiple agent sessions use `ON CONFLICT DO UPDATE` for thread assignment. Acceptable for single-user — no row-level locking needed. |
| Plain text body truncated to 2000 chars | Enough for classification. HTML adds noise, full body wastes storage. Not archival — just for agent context. |
| No Events table in v1 | Read live from Calendar API — no persistence needed yet. |
| No Actions/audit trail table in v1 | Conversation IS the approval queue. Agent proposes in chat, user confirms or declines in natural language. |
| No Tasks entity in v1 | User manages tasks in their own system. |

## Tech Stack

| Decision | Rationale |
|---|---|
| TypeScript on Node.js 20 LTS | Single language across backend, frontend, and agent code. Shared types eliminate cross-language sync friction. |
| Hono for backend API | Lightweight, TypeScript-first. Backend stays independent of frontend for future MCP/plugin exposure. |
| Drizzle ORM | Schema-as-TypeScript gives type safety. SQL-like builder works well with Postgres-specific features (JSONB, GIN, advisory locks). |
| React via Vite + React Router (not Next.js) | SPA is sufficient — no SSR/SEO needed for single-user app. Vite is simpler, Next.js adds unnecessary weight. |
| Claude Agent SDK (TypeScript) | Agent framework. Uses `query()` async generator (not class-based). `createSdkMcpServer()` + `tool()` helper with Zod schemas for in-process MCP tools. Main agent (Opus/Sonnet) with Haiku subagents for parallel work. Model ID: `claude-opus-4-6` (verified against Anthropic API). |
| googleapis for OAuth + API | Already needed for GSuite APIs. Handles OAuth flow, token refresh, offline access. No second auth library needed. |
| Flat project structure (no pnpm workspaces) | Single `package.json`. Shared types imported directly. Simpler than monorepo for single-user app. |

## Architecture

| Decision | Rationale |
|---|---|
| Agent-proposes, human-confirms (chat-based) | Universal pattern for side-effect operations. Agent describes action in text and asks for confirmation. User replies in natural language ("go ahead", "yes", "no"). No special buttons or message types — approval is a normal chat exchange. Trust earned incrementally. |
| Approval enforcement is prompt-only in v1 | No tool-layer gate or approval tokens. The system prompt instructs the agent to wait for user confirmation before executing write actions. Single-user app — worst case is an unwanted email/event, which is reversible. Tool-layer enforcement can be added later if needed. |
| Connectors as singletons | Module-level singletons initialized at startup. Imported directly by any layer that needs them — no parameter passing. Simpler than dependency injection for single-user app. |
| No dry run mode | Test suite provides sufficient coverage. Dry run would add complexity to every connector and action for a rarely-used feature. |
| Dual interaction paths (agent + direct UI) | Agent chat for intelligence (classification, drafting). REST API for explicit user actions (reply, edit event). Both share the same `google/*` connectors and `db/queries`. |
| In-process MCP server (no subprocess) | Google connectors run in-process via `googleapis`. No external MCP subprocess, no IPC overhead. |
| Email tools split: `sync_email` + `action_email` | Clean read/write separation. `sync_email` handles all reads (sync, search, get_thread, get_unbucketed) — always syncs to local cache first. `action_email` handles all writes (send, reply, draft, archive, mark_read) — always requires approval. No overlap, no "sometimes cached, sometimes live" confusion. |
| Email orchestration layer (`email.ts`) | `sync_email` tool delegates to `email.ts`, which coordinates between `gmail.ts` (Google API) and `queries.ts` (DB). Keeps tools thin, keeps `gmail.ts` free of DB logic, keeps `queries.ts` free of Gmail logic. REST routes also use `email.ts` for email reads. All email writes also route through `email.ts` (thin pass-throughs to `gmail.ts`) so tools and routes have a single import path for all email operations. |
| Calendar/Drive routes call connectors directly (no orchestration layer) | Unlike email, calendar and drive have no local cache — all data is fetched live from Google APIs. An orchestration layer would be a pass-through with no added value. If caching is added later, introduce a `calendar.ts` orchestration layer at that point. |
| `sync` vs `search` separation in `sync_email` | `sync` is bulk inbox refresh (diff-based, fetches only new/changed threads, returns stats). `search` is ad-hoc query (finds specific threads, returns results). Both persist to local cache. Bucketing uses `sync` → `get_unbucketed` loop. Meeting prep / draft reply use `search`. |
| Google tokens in Postgres, not filesystem | Survives Railway's ephemeral filesystem across deploys. `google/auth.ts` upserts on every token refresh. |
| WebSocket auth via session cookie | Same-origin cookie validated on connection upgrade. Same cookie used for REST — unified auth model. |
| No preferences system in v1 | Useful but not essential for core loop. Deferred. |
| No heartbeat/background cron in v1 | Requires infra complexity. User-initiated workflows are sufficient for v1. |
| Subagents for parallel read-only work | Main agent spawns Haiku subagents (`email_classifier`, `meeting_prepper`, `researcher`) for parallelizable tasks. Subagents have scoped read-only tool access — no write operations. Main agent decides when to fan out vs. handle inline based on volume. Keeps main context clean (subagent context is discarded, only summary returns). |
| Token-by-token streaming over WebSocket | Agent SDK streams partial responses from the Anthropic API. Backend forwards each token over WebSocket as `{ type: 'text_delta', content }`. Frontend accumulates deltas into the current assistant message, giving a real-time typing effect. On stream completion, backend sends `{ type: 'text_done', content }` with the full response and persists it to Postgres. |
| No response envelope or decorator | Routes use `c.json()` directly. No `endpoint()` wrapper, no `{ data: T }` envelope. Errors already have their own shape via `app.onError()`. Simpler routes, simpler frontend code. |
| One data hook per resource, not per component | `useBuckets`, `useCalendarEvents`, `useConversations` — each hook owns all fetching and mutations for its resource. Refetches on local mutations and on window focus. Single refetch function with dedup prevents competing fetches. |
| WebSocket is chat-only, no event bus | WebSocket exists only for agent chat streaming (`text_delta`, `text_done`, `chat`, `error`). No `data_changed` events, no `EventEmitter`, no `WebSocketProvider`. Connection is per-conversation (`/ws?conversationId=xxx`), opened when a conversation is active, reconnects on switch. Data hooks use REST and refetch after their own mutations. Agent-initiated data changes are picked up when `text_done` fires — all active hooks refetch at that point. Simpler than a real-time event bus; acceptable staleness during agent execution since the user is watching the chat stream. |

## Security & Robustness

| Decision | Rationale |
|---|---|
| Google tokens encrypted at rest (AES-256-GCM) | Tokens grant full Gmail/Calendar/Drive access. Plaintext in Postgres is unacceptable even for single-user — DB compromise = full account takeover. |
| Cookie-only auth with CSRF token header | One httpOnly session cookie for all requests (REST + WebSocket). CSRF protection via `X-CSRF-Token` header (HMAC of session cookie) required on POST/PUT/PATCH/DELETE. Simpler than dual auth (bearer + cookie) — no token in URLs, no JS-stored JWTs, survives page refresh. |
| Required env vars validated at startup | Fail fast with clear error instead of cryptic runtime failures from missing config. |
| Session cookie `secure` conditional on NODE_ENV | `secure: true` blocks cookies over HTTP in local dev. Conditional flag allows localhost development while keeping production secure. |
| Parallel Gmail thread fetching (p-limit, concurrency 5) | Sequential fetches in syncInbox made bulk sync unacceptably slow (~4s per thread). Parallel with concurrency limit respects Gmail rate limits while cutting sync time ~5x. |
| WebSocket messages validated with Zod | Malformed JSON or unexpected message types crashed the handler. Zod discriminated union + try-catch provides safe parsing. |
| Graceful shutdown on SIGTERM | Railway sends SIGTERM on redeploy. Without handling it, active WebSocket connections and in-flight agent responses are killed mid-stream. |

## Chat Persistence

| Decision | Rationale |
|---|---|
| Postgres for message history, SDK for agent context | Two different purposes: Postgres gives durable UI display history that survives redeploys. SDK session gives agent working memory with compaction. Neither replaces the other. |
| `conversations` + `chat_messages` tables, no user_id | Consistent with single-user model. Conversations own messages via FK cascade. |
| SDK session ID stored on conversation row | Enables resume after disconnect. Single nullable column — null means session was lost. |
| Accept context loss on Railway redeploy | SDK session files are ephemeral on Railway. Rather than syncing SDK state to Postgres (complex, fragile), accept that agent context resets on redeploy. User sees full history in UI; agent starts fresh. |
| Auto-title from first user message (truncated to 80 chars) | Simple, immediate, no LLM call needed. Good enough for v1. Can upgrade to LLM-generated titles later. |
| conversationId as WebSocket query param | Simpler than a handshake message. Client creates conversation via REST first, then connects WebSocket with the ID. |
| No search, folders, or archiving for v1 | Keep it simple. List of conversations sorted by recency is sufficient for a single user. |
| Postgres messages are display-only, not fed back to SDK | On session loss, we do NOT replay Postgres messages into the SDK. This would be expensive and unreliable (tool calls can't be replayed). User gets visual continuity; agent gets a fresh start. |
