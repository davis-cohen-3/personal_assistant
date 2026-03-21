# Phase 1: Scaffolding + Foundations — Completion Report

## Summary

Phase 1 establishes the project scaffolding, quality gates, and foundational types. After this phase, `pnpm install`, `pnpm run build`, `pnpm test`, `pnpm run lint`, and `pnpm run lint:arch` all succeed, and the health check returns `{ status: "ok" }`.

---

## Task 1.1: Project Structure, Configs, and Placeholders

### Files Created

| File | Purpose |
|------|---------|
| `package.json` | All production + dev dependencies, scripts, lint-staged config |
| `tsconfig.json` | Base TypeScript config (strict, ESNext, bundler resolution, path aliases) |
| `tsconfig.server.json` | Server build config extending base, `moduleResolution: "node16"` (FEAS-013) |
| `vite.config.ts` | React plugin, client root, proxy for `/ws`, `/auth`, `/api` |
| `vitest.config.ts` | Node environment, `tests/unit/**/*.test.ts` include pattern, `@shared` alias |
| `biome.json` | Biome 2.0 config — recommended rules, 2-space indent, 100 line width |
| `docker-compose.yml` | Postgres 16 with `pa_agent` user/db, named volume |
| `drizzle.config.ts` | Schema path, migrations output, postgresql dialect |
| `.env.example` | All env vars including `CSRF_SECRET` (HIGH-9) |
| `.gitignore` | dist, node_modules, .env, logs, .DS_Store, SDK session files (SEC-006) |
| `src/server/index.ts` | Minimal Hono app with `GET /health`, SIGTERM shutdown |
| `src/client/index.html` | Vite HTML entry point |
| `src/client/main.tsx` | React root render |
| `src/client/App.tsx` | `<div>App</div>` placeholder |
| `src/client/globals.css` | Tailwind base import (`@import "tailwindcss"`) |
| `tests/unit/placeholder.test.ts` | Placeholder test so `pnpm test` passes with 0 failures |

### Decisions & Deviations

- **Biome 2.0 config schema change**: The design doc used Biome 1.x config keys (`organizeImports`, `files.ignore`). Biome 2.0 moved these to `assist.actions.source.organizeImports` and `files.includes`/`files.experimentalScannerIgnores`. Updated accordingly.
- **mimetext version**: Design doc specified `^4.0.0` but latest published is `3.0.28`. Pinned to `^3.0.0`.
- **`console.error` instead of `console.warn`**: A pre-commit hook blocks `console.warn` in production code (alongside `console.log`, `console.info`, `console.debug`). Used `console.error` for server startup/shutdown messages. This contradicts CLAUDE.md which says to use `console.error`/`console.warn`, but the hook enforces `console.error` only.
- **Vite entry HTML**: Added `src/client/index.html` which the design doc's project structure didn't explicitly mention but Vite requires.

### Review Issues Addressed

| Issue | Resolution |
|-------|-----------|
| FEAS-013 | `tsconfig.server.json` overrides `moduleResolution` to `"node16"` |
| MIN-010 | Biome pinned to `2.0.0` in `devDependencies` |
| HIGH-9 | `CSRF_SECRET` included in `.env.example` as separate from `JWT_SECRET` |
| SEC-006 | `.gitignore` includes `.claude-session/` and `*.session.json` |

---

## Task 1.2: Foundations + Architecture Linters + Git Hooks

### Files Created

| File | Purpose |
|------|---------|
| `src/server/exceptions.ts` | `AppError` class with `status`, `cause`, and `userFacing` flag |
| `src/shared/types.ts` | All shared types: `ChatMessage`, WS messages, `Conversation`, `ChatMessageRecord` |
| `scripts/lint_module_boundaries.ts` | Dependency direction enforcement between server layers |
| `scripts/lint_db_encapsulation.ts` | DB queries must stay in `src/server/db/` |
| `scripts/lint_async_hygiene.ts` | No blocking calls (`readFileSync`, `execSync`, etc.) in server code |
| `.husky/pre-commit` | Runs `npx lint-staged` before each commit |
| `.github/workflows/ci.yml` | Two parallel jobs: lint+typecheck+arch, and unit tests |

### `AppError` Design (HIGH-4)

```typescript
export class AppError extends Error {
  public readonly userFacing: boolean;
  constructor(
    message: string,
    public readonly status: number = 500,
    options?: ErrorOptions & { userFacing?: boolean },
  )
}
```

- `userFacing` defaults to `false` — safe by default
- When `userFacing` is true, `app.onError` can expose `err.message` to the client
- When false, return a generic message and log details server-side
- `ErrorOptions` support for `cause` chaining

### Shared Types (`src/shared/types.ts`)

Types defined:
- `ChatMessage` — `{ role, text, streaming? }` used by frontend for rendering
- `WsChatMessage` — frontend→backend: `{ type: "chat", content }`
- `WsTextDelta` — backend→frontend: streaming token
- `WsTextDone` — backend→frontend: full response on stream complete
- `WsError` — backend→frontend: error message
- `WsConversationUpdated` — backend→frontend: title update after auto-titling
- `WsServerMessage` — union of all backend→frontend types
- `Conversation` — id, title, sdkSessionId, timestamps
- `ConversationWithMessages` — extends Conversation with messages array
- `ChatMessageRecord` — DB record shape for chat messages

### Architecture Linters (CLARITY-024)

All three linters include `!fs.existsSync(target)` guards so they pass when target directories don't exist yet (during scaffolding phase).

**`lint_module_boundaries.ts`** enforces:
- `google/*` must NOT import db/, routes, agent, tools, email
- `db/*` must NOT import google/, routes, agent, tools
- `tools.ts` must NOT import routes, agent
- `routes.ts` must NOT import tools, agent

Includes multi-level relative paths (`../../db`, `../../routes`, etc.) per CLARITY-024.

**`lint_db_encapsulation.ts`** detects:
- `db.select()`, `db.insert()`, `db.update()`, `db.delete()`
- `db.query`
- `from(schema.*)` outside `src/server/db/`
- Supports `// lint-ignore` for exceptions

**`lint_async_hygiene.ts`** detects:
- `readFileSync`, `writeFileSync`, `existsSync`, `mkdirSync`
- `execSync`, `spawnSync`
- `Atomics.wait`
- Only scans `src/server/`, not `scripts/`

### CI Configuration

Two parallel jobs in `.github/workflows/ci.yml`:
1. **lint** — `pnpm run lint` + `tsc --noEmit` + `pnpm run lint:arch`
2. **test** — `pnpm test`

Both use Node 20, pnpm with caching, and `--frozen-lockfile`.

---

## Verification Results

| Check | Status |
|-------|--------|
| `pnpm install` | Pass |
| `pnpm run lint` | Pass (1 warning: non-null assertion in standard React pattern) |
| `pnpm run lint:arch` | Pass (all 3 linters) |
| `pnpm exec tsc --noEmit` | Pass (zero errors) |
| `pnpm test` | Pass (1 placeholder test) |
| `GET /health` | Returns `{"status":"ok"}` |

---

## Directory Structure After Phase 1

```
personal-assistant-agent/
├── .github/workflows/ci.yml
├── .gitignore
├── .husky/pre-commit
├── biome.json
├── docker-compose.yml
├── drizzle.config.ts
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.server.json
├── vite.config.ts
├── vitest.config.ts
├── .env.example
├── scripts/
│   ├── lint_module_boundaries.ts
│   ├── lint_db_encapsulation.ts
│   └── lint_async_hygiene.ts
├── src/
│   ├── client/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── globals.css
│   ├── server/
│   │   ├── index.ts
│   │   └── exceptions.ts
│   └── shared/
│       └── types.ts
└── tests/
    └── unit/
        └── placeholder.test.ts
```
