# Tech Stack

## Summary

| Layer | Choice |
|---|---|
| Language / Runtime | TypeScript on Node.js (v20 LTS) |
| Web Framework | Hono |
| Database | PostgreSQL 16 |
| ORM / Query Layer | Drizzle ORM |
| Frontend Framework | React via Vite + React Router |
| Agent Framework | Claude Agent SDK (TypeScript) |
| Background Jobs | node-cron (in-process) |
| Auth | Google OAuth 2.0 via `googleapis` |
| Package Manager | pnpm |
| Monorepo | pnpm workspaces |

---

## Decisions

### Language / Runtime — TypeScript on Node.js

**What:** TypeScript 5.x targeting Node.js 20 LTS. Strict mode enabled.

**Why:**
- Claude Agent SDK has full TypeScript support.
- Single language across backend, frontend, and agent code.
- Shared types between frontend and backend — this app passes a lot of structured data (action cards, briefings, classifications) and keeping those in sync across two languages would be ongoing friction.

**Rejected:**
- **Python** — Agent SDK supports Python too. Davis is more experienced in Python, but the shared-types advantage of a single language across frontend and backend outweighs that.

---

### Web Framework — Hono

**What:** Hono as the backend HTTP framework, running on Node.js.

**Why:**
- Lightweight, modern, TypeScript-first.
- This is a thin API layer proxying between frontend and agent/GSuite APIs — doesn't need a heavy framework.
- Easy SSE/WebSocket support for streaming.

**Rejected:**
- **Express** — dated API, weaker TypeScript story.
- **Fastify** — solid but heavier than needed for single-user.
- **Next.js API Routes** — would couple backend to frontend. Backend needs to be independently deployable for future MCP/Skills plugin exposure.

---

### Database — PostgreSQL 16

**What:** PostgreSQL 16. Local dev: Docker via docker-compose. Production: Docker on same machine.

**Why:** Already decided ([decisions_log.md](../tasks/decisions_log.md)). JSONB for flexible metadata, GIN indexes for array lookups, `pg_advisory_lock` for heartbeat mutual exclusion.

**Rejected:**
- **SQLite** — no JSONB, no advisory locks, limited concurrent access.

---

### ORM / Query Layer — Drizzle ORM

**What:** Drizzle ORM with `drizzle-kit` for migrations.

**Why:**
- Schema defined in TypeScript — doubles as type source. No separate type generation step.
- SQL-like query builder stays close to the metal. Important for Postgres-specific features (JSONB operators, GIN indexes, advisory locks).
- Built-in migration tooling (`drizzle-kit generate` + `drizzle-kit migrate`).
- Lightweight runtime.

**Rejected:**
- **Prisma** — own schema DSL (not TypeScript), heavier runtime, JSONB less ergonomic.
- **Knex** — query builder only, no schema-as-types.
- **Raw `pg`** — no type safety, no migrations, too much boilerplate.

---

### Frontend Framework — React via Vite + React Router

**What:** Vite as build tool, React 18, React Router for routing. Single-page app.

**Why:**
- React was already decided. Vite gives fast dev builds and a clean SPA.
- Single-user app with a separate backend — no need for SSR, SSG, or SEO.
- React Router handles routing without the overhead of a meta-framework.

**Rejected:**
- **Next.js** — adds weight we don't need. No SSR requirement, not using its API routes. Would be justified if we needed SSR or were using it as the backend too.
- **Remix** — smaller ecosystem, no clear advantage here.

---

### Agent Framework — Claude Agent SDK

**What:** `@anthropic-ai/agent-sdk` (TypeScript) for orchestrator and subagent implementation.

**Why:** Prescribed framework for building agent systems with Claude.

**Implementation approach:**
- **Orchestrator** — long-lived Agent SDK instance maintaining conversation state with the user. Has tools for dispatching skills and accessing the database.
- **Subagents** — ephemeral Agent SDK instances created per-skill invocation. Scoped tools + hydrated context. Return structured JSON. Never talk to the user directly.

See [agent_architecture.md](agent_architecture.md) for full detail.

---

### Background Jobs — node-cron

**What:** `node-cron` for heartbeat scheduling, running in the same Node.js process as the API server.

**Why:**
- Single-user app with one recurring job — no need for a distributed job queue.
- In-process means no additional infrastructure.
- Handler acquires `pg_advisory_lock` before running to prevent overlap (per system_spec.md).

**Rejected:**
- **System cron** — harder in Docker, no access to app's DB connection pool.
- **BullMQ** — requires Redis. Overkill for one job.
- **pg-boss** — overkill for one job.

---

### Auth — Google OAuth 2.0

**What:** Google OAuth 2.0 authorization code grant via `googleapis` npm package. Offline access for refresh tokens (heartbeat needs API access without user present).

**Why:**
- GSuite integration requires OAuth anyway — no reason for a second auth system.
- Single-user: OAuth flow doubles as "connect your Google account" and "log in."
- `googleapis` handles token refresh, API calls, and scope management.

**Rejected:**
- **Passport.js** — abstraction over a straightforward single-provider flow.
- **NextAuth / Auth.js** — designed for multi-user, multi-provider. Overkill.

---

### Package Manager — pnpm

**What:** pnpm with workspaces for monorepo management.

**Why:** Fast, disk-efficient, best-in-class workspace support for our monorepo structure.

**Rejected:**
- **npm** — slower, weaker workspace support.
- **yarn** — two competing versions (classic vs berry), confusing.

---

## Monorepo Structure

pnpm workspaces with three packages:

```
packages/
  backend/     ← Hono API server + agent + heartbeat
  frontend/    ← Vite + React app
  shared/      ← Types, schemas, constants shared between backend and frontend
```

Backend stays independently deployable for future MCP/Skills plugin exposure.

See [codebase_architecture.md](codebase_architecture.md) for detailed directory layout.

---

## Key Dependencies

| Package | Purpose |
|---|---|
| `@anthropic-ai/agent-sdk` | Orchestrator + subagent implementation |
| `googleapis` | Gmail, Calendar, Drive API access + OAuth |
| `hono` | Backend HTTP framework |
| `drizzle-orm` + `drizzle-kit` | ORM, migrations, schema-as-types |
| `react` + `react-dom` | UI library |
| `react-router-dom` | Client-side routing |
| `vite` | Frontend build tool |
| `node-cron` | Heartbeat scheduler |
| `pg` | Postgres driver (used by Drizzle) |
| `zod` | Runtime validation for agent return contracts and API inputs |
| `ws` | WebSocket server for streaming |
