# Personal Assistant Agent

Single-user AI assistant for Google Workspace (Gmail, Calendar, Drive). Claude Agent SDK + Hono backend, React frontend, Postgres persistence. Deployed on Railway.

**Before writing any code:** Read the relevant source files. Verify method names, signatures, and types exist before calling them. Do not assume patterns — search for how existing code does it and follow that. When a task is ambiguous, ask or check specs before guessing.

## Build & Test

```bash
./run_dev.sh                    # Start Postgres, migrations, backend + frontend
pnpm run build                  # Production build (vite + tsc)
pnpm run start                  # Production start
pnpm test                       # Run all tests
pnpm test -- --grep "pattern"   # Specific test
tail -100 logs/server.log       # Check dev logs
```

Run all commands from project root.

## Architecture

```
React Frontend (Vite) → Hono Backend → PostgreSQL
                              │
                    ┌─────────┼──────────┐
              Agent SDK    Google APIs   REST API
              (WebSocket)  (in-process)  (direct UI)
```

**Dual interaction paths:**
- **Agent Chat (WebSocket)** — User messages → Agent SDK → MCP tools → token-by-token streamed responses
- **Direct UI (REST)** — User clicks → REST endpoints → Google connectors → immediate response

Both paths share the same `google/*` connectors. Agent writes data via tools, frontend renders from REST state.

**Key principle:** Agent is text-only in chat. No dynamic UI blocks from agent. All structured data rendered by React components fetching from REST.

| System | Location |
|--------|----------|
| Backend Server | `src/server/` |
| Agent Config | `src/server/agent.ts` |
| MCP Tools | `src/server/tools.ts` |
| REST Routes | `src/server/routes.ts` |
| Google Connectors | `src/server/google/` |
| Database | `src/server/db/` |
| Frontend | `src/client/` |
| Shared Types | `src/shared/types.ts` |

## Code Style

- **TypeScript strict mode** — No `any`, no `as any`, no type assertions unless verified at runtime
- **Fail fast** — No fallbacks, no silent defaults, no swallowed errors
- **Async everywhere** — All I/O is async/await
- **Use console.error/console.warn for logging** — No external logger for v1
- Anti-patterns and fail-fast rules: @agent_docs/code-quality.md

## Gotchas

**Hooks block these** (won't let you write):
```typescript
const value: any = ...                    // ❌ any type
const x = foo as any;                     // ❌ as any assertion
console.log("debug");                     // ❌ console.log for debugging (use console.error/warn)
try { await doThing(); } catch {}         // ❌ Swallowed exception
const v = config.get('key') ?? 'default'; // ❌ Fallback defaults
```

**IMPORTANT:** No fallback returns in catch blocks. No business logic in routes — delegate to query functions. Routes and MCP tools share the same queries and connectors. Full reference in `agent_docs/code-quality.md`.

## Workflow

- Plan before code: `/brainstorm` for exploration, `/spec-driven-dev` for structured planning
- TDD always: write tests first (`/tdd`), then implement
- Specs live in `specs/{issue}/` — requirements, design, tasks, sessions
- All skills in `.claude/skills/`, invoke with `/skill-name`
- `/save-history` at ~70% context to preserve session state

```
/new-issue → /brainstorm → /synthesize → /review-spec requirements
  → /spec-driven-dev → /review-spec design → /tdd → /update-docs
```

## Adding a New Feature (Checklist)

1. **Schema** — Add table/columns in `src/server/db/schema.ts` (Drizzle)
2. **Queries** — Add CRUD functions in `src/server/db/queries.ts`
3. **MCP Tool** — If agent needs access, add tool in `src/server/tools.ts`
4. **REST Route** — If direct UI needs access, add endpoint in `src/server/routes.ts`
5. **Frontend Component** — React component fetching from REST API
6. **Tests** — Integration tests for queries + routes, component tests if complex
7. **Migration** — `npx drizzle-kit generate` then `npx drizzle-kit migrate`

## Documentation

**Only read the doc you need.**

| Doc | When to Read |
|-----|--------------|
| `agent_docs/code-quality.md` | **Read before writing any code** |
| `agent_docs/backend-patterns.md` | Routes, queries, connectors, tools |
| `agent_docs/testing.md` | How to write tests (which type, fixtures, patterns) |
| `project/design/` | Full system spec and architecture |

## Current Work

Check `specs/` for active work. Read `specs/{issue}/sessions/` for context.
