# Tech Stack

## Dependencies

| Package | Purpose |
|---|---|
| `@anthropic-ai/claude-agent-sdk` | Agent framework — MCP integration |
| `mimetext` | RFC 2822 email construction for Gmail send/reply |
| `hono` | Backend HTTP framework |
| `@hono/node-server` | Hono adapter for Node.js (includes `serve-static`) |
| `@hono/node-ws` | WebSocket support for Hono on Node.js |
| `zod` | Schema validation and type inference |
| `drizzle-orm` | ORM — schema-as-types, query builder |
| `drizzle-kit` | Migration generation and execution |
| `pg` | Postgres driver (used by Drizzle) |
| `googleapis` | Google API client — Gmail, Calendar, Drive, OAuth (see `07_google_connectors.md`) |
| `p-limit` | Concurrency limiter for parallel API calls |
| `react` + `react-dom` | UI library |
| `tailwindcss` | Utility-first CSS framework |
| `vite` | Frontend build tool and dev server |
| `@vitejs/plugin-react` | Vite plugin for React (JSX transform, fast refresh) |
| `typescript` | Language |

### Dev Dependencies

| Package | Purpose |
|---|---|
| `@types/node` | Node.js type definitions |
| `@types/react` + `@types/react-dom` | React type definitions |
| `@types/pg` | Postgres driver types |
| `tsx` | TypeScript execution for dev server |
| `concurrently` | Run backend + frontend dev servers in parallel |
| `vitest` | Test runner — native TypeScript, Vite-compatible |
| `@biomejs/biome` | Linting and formatting (replaces ESLint + Prettier) |
| `husky` | Git hooks manager |
| `lint-staged` | Run linters on staged files only |

### UI Components (shadcn/ui)

shadcn/ui components are copied into the project (not installed as a package). Initialized via `npx shadcn@latest init` and components added via `npx shadcn@latest add button card ...`. These live in `src/client/components/ui/`.

---

## Runtime

- **Node.js 20 LTS** — single runtime for everything
- **TypeScript 5.x** — strict mode enabled
- **Postgres 16** — local dev via Docker (see docker-compose below)

---

## Project Structure (Flat)

No pnpm workspaces. Everything lives under one `package.json`.

```
personal-assistant-agent/
├── package.json
├── tsconfig.json
├── tsconfig.server.json       ← Server build config (extends tsconfig.json)
├── drizzle.config.ts
├── vite.config.ts
├── .env.example                ← Required env vars with descriptions (not committed values)
├── .gitignore
├── docker-compose.yml          ← Postgres for local dev
├── logs/                       ← Server logs (gitignored)
│   └── server.log
├── scripts/
│   ├── dev.sh                  ← Start Postgres + backend + frontend for local dev
│   ├── migrate.sh              ← Run Drizzle migrations (local + CI)
│   ├── lint_module_boundaries.ts  ← Architecture: dependency direction
│   ├── lint_db_encapsulation.ts   ← Architecture: queries stay in db/
│   └── lint_async_hygiene.ts      ← Architecture: no blocking calls
├── tests/
│   └── unit/                   ← Vitest unit tests (see 10_dev_tooling.md)
├── src/
│   ├── server/
│   │   ├── index.ts          ← Hono app, WebSocket route, static file serving
│   │   ├── exceptions.ts     ← AppError class for typed error propagation
│   │   ├── agent.ts          ← Agent SDK config, session management, WebSocket handler
│   │   ├── email.ts          ← Email read orchestration (sync, search, cache management)
│   │   ├── tools.ts          ← 5 MCP tools (2 email + 2 Google + 1 data)
│   │   ├── routes.ts         ← REST API for direct UI actions (schemas defined inline)
│   │   ├── auth.ts           ← Google OAuth routes + email allowlist + session middleware
│   │   ├── google/
│   │   │   ├── auth.ts       ← OAuth2 client, token persistence, refresh
│   │   │   ├── gmail.ts      ← Gmail connector
│   │   │   ├── calendar.ts   ← Calendar connector
│   │   │   ├── drive.ts      ← Drive/Docs connector
│   │   │   └── index.ts      ← Re-exports
│   │   └── db/
│   │       ├── index.ts      ← Drizzle client
│   │       ├── schema.ts     ← Drizzle schema (8 tables)
│   │       ├── queries.ts    ← CRUD functions
│   │       └── migrations/
│   ├── client/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── globals.css       ← Tailwind base styles
│   │   ├── hooks/
│   │   │   ├── useBuckets.ts       ← Fetch + mutations + refetch
│   │   │   ├── useCalendarEvents.ts ← Fetch + mutations + refetch
│   │   │   └── useConversations.ts  ← Fetch + mutations + refetch
│   │   └── components/
│   │       ├── ui/           ← shadcn/ui components (Button, Card, Spinner, etc.)
│   │       ├── Chat.tsx
│   │       ├── BucketBoard.tsx     ← Data panel: uses useBuckets()
│   │       ├── CalendarView.tsx    ← Data panel: uses useCalendarEvents()
│   │       ├── ThreadDetail.tsx    ← Detail panel: full thread view + reply + archive
│   │       └── EventDetail.tsx     ← Detail panel: event view + edit + delete
│   └── shared/
│       └── types.ts          ← Message shapes, API response types
├── .claude/
│   └── skills/               ← Agent workflow definitions
│       ├── morning_briefing.md
│       ├── inbox_review.md
│       ├── draft_reply.md
│       └── meeting_prep.md
└── CLAUDE.md
```

---

## `.gitignore`

```gitignore
# Build output
dist/

# Dependencies
node_modules/

# Environment
.env

# Logs
logs/

# Editor
.vscode/
*.swp

# OS
.DS_Store
```

---

## Environment Variables (`.env.example`)

Committed to the repo with placeholder values. Copy to `.env` and fill in real values.

```bash
# .env.example

# Database — matches docker-compose.yml defaults for local dev
DATABASE_URL=postgresql://pa_agent:pa_agent@localhost:5432/pa_agent

# Auth — comma-separated email allowlist
ALLOWED_USERS=you@gmail.com
JWT_SECRET=          # generate with: openssl rand -hex 32

# Google OAuth — from Google Cloud Console
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Agent
ANTHROPIC_API_KEY=

# Encryption
ENCRYPTION_KEY=          # generate with: openssl rand -hex 32
```

---

## Docker Compose (Local Dev)

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: pa_agent
      POSTGRES_USER: pa_agent
      POSTGRES_PASSWORD: pa_agent
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

---

## Scripts

All operational scripts live in `scripts/`. Shell scripts for dev/ops, TypeScript for custom linters.

```bash
# scripts/dev.sh — starts Postgres, backend, and frontend for local development
# Logs backend output to logs/server.log

#!/usr/bin/env bash
set -e

mkdir -p logs

# Start Postgres if not already running
if ! docker compose ps postgres --status running -q 2>/dev/null | grep -q .; then
  echo "Starting Postgres..."
  docker compose up -d postgres
  sleep 2
fi

# Run migrations
echo "Running migrations..."
pnpm drizzle-kit migrate

# Start backend and frontend concurrently, logging to server.log
echo "Starting dev servers... (logs in logs/server.log)"
pnpm concurrently \
  --names "server,client" \
  "tsx watch src/server/index.ts 2>&1 | tee logs/server.log" \
  "vite"
```

```bash
# scripts/migrate.sh — run Drizzle migrations
# Used locally and in CI. Requires DATABASE_URL.

#!/usr/bin/env bash
set -e
echo "Running migrations..."
pnpm drizzle-kit migrate
echo "Migrations complete."
```

See `10_dev_tooling.md` for custom architecture linters (`scripts/lint_*.ts`).

---

## Build & Dev Scripts

```jsonc
// package.json scripts
{
  "scripts": {
    "dev": "./scripts/dev.sh",
    "build": "vite build && tsc --project tsconfig.server.json",
    "start": "node dist/server/index.js",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "./scripts/migrate.sh",
    "db:studio": "drizzle-kit studio",
    "lint": "biome check src/",
    "lint:fix": "biome check --fix src/",
    "lint:arch": "tsx scripts/lint_module_boundaries.ts && tsx scripts/lint_db_encapsulation.ts && tsx scripts/lint_async_hygiene.ts",
    "format": "biome format --write src/",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

- `dev` — runs the dev script (Postgres + migrations + backend + frontend)
- `build` — builds frontend (vite) and compiles server TypeScript
- `start` — runs the compiled server in production
- `db:generate` — generates SQL migrations from schema changes
- `db:migrate` — applies pending migrations
- `db:studio` — opens Drizzle Studio for database inspection

---

## Vite Config

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/client'),
    },
  },
  build: {
    outDir: '../../dist/client',
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/auth': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
    },
  },
});
```

In dev, Vite proxies WebSocket and API requests to the Hono backend. In production, the Hono server serves the built frontend static files (see `04_backend.md` for static file middleware).

---

## TypeScript Config

Base config for shared settings. The server and client extend it.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "jsx": "react-jsx",
    "paths": {
      "@shared/*": ["./src/shared/*"],
      "@/*": ["./src/client/*"]
    }
  },
  "include": ["src"]
}
```

Server-specific config used by the build script (`tsc --project tsconfig.server.json`). Compiles server + shared code to `dist/`, excludes client code (Vite handles that).

```jsonc
// tsconfig.server.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/server", "src/shared"]
}
```

---

## Deployment

See `09_deployment.md` for full deployment and DevOps details. Summary: GCP Cloud Run, scale-to-zero, platform-managed Postgres and TLS.
