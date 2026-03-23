# Personal Assistant Agent

An AI-powered personal assistant for Google Workspace. Chat with an agent that can read, organize, and act on your Gmail, Calendar, and Drive — or use the direct UI for quick access.

Built with Claude Agent SDK, Hono, React, and PostgreSQL.

## What It Does

**Gmail** — Sync your inbox, search threads, organize emails into custom buckets, send messages, reply, draft, trash, and mark as read.

**Calendar** — View events, create meetings, update or cancel them, and check free/busy availability.

**Drive** — Search files, browse recent documents, and read document contents.

**Agent Chat** — Conversational interface powered by Claude. The agent uses MCP tools to interact with your Google services, streams responses over WebSocket, and asks for approval before taking actions (sending emails, creating events, etc.).

## Architecture

```
React (Vite + Tailwind)  →  Hono Backend  →  PostgreSQL
                                  │
                      ┌───────────┼───────────┐
                Agent SDK      Google APIs    REST API
                (WebSocket)   (connectors)   (direct UI)
```

Two interaction paths share the same connectors and query layer:

- **Agent Chat** — WebSocket → Agent SDK → MCP tools → streamed token-by-token responses
- **Direct UI** — React components → REST endpoints → immediate JSON responses

```
src/
├── server/
│   ├── index.ts           # Hono server, WebSocket upgrade
│   ├── agent.ts           # Agent SDK integration, streaming
│   ├── tools.ts           # MCP tool definitions (5 tools)
│   ├── routes.ts          # REST API (thin routing layer)
│   ├── auth.ts            # JWT sessions, CSRF
│   ├── email.ts           # Inbox sync, search, send/reply
│   ├── crypto.ts          # AES-256-GCM token encryption
│   ├── db/
│   │   ├── schema.ts      # Drizzle ORM table definitions
│   │   └── queries.ts     # All database operations
│   └── google/
│       ├── auth.ts        # Google OAuth, token storage/refresh
│       ├── gmail.ts       # Gmail API wrapper
│       ├── calendar.ts    # Calendar API wrapper
│       ├── drive.ts       # Drive API wrapper
│       └── index.ts       # Re-exports
├── client/
│   ├── App.tsx            # Layout, tabs (inbox/calendar)
│   ├── components/
│   │   ├── ChatPanel.tsx  # WebSocket chat, message streaming
│   │   ├── InboxView.tsx  # Email buckets and thread lists
│   │   └── CalendarView.tsx
│   └── hooks/             # Data fetching (buckets, events, conversations)
└── shared/
    └── types.ts           # WebSocket message types, shared interfaces
```

## Local Setup

### Prerequisites

- Node.js 20+
- pnpm
- PostgreSQL 16+
- A [Google Cloud](https://console.cloud.google.com) project with OAuth 2.0 credentials and Gmail, Calendar, and Drive APIs enabled
- An [Anthropic API key](https://console.anthropic.com)

### 1. Clone and install

```bash
git clone <repo-url> && cd personal-assistant-agent
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Postgres connection string (default works with docker-compose) |
| `ALLOWED_USERS` | Comma-separated email allowlist |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `CSRF_SECRET` | `openssl rand -hex 32` (must differ from JWT_SECRET) |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/auth/google/callback` |
| `ANTHROPIC_API_KEY` | Claude API key |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` |

### 3. Run

```bash
./scripts/run_dev.sh
```

This sources `.env`, runs Drizzle migrations, then starts the backend (`tsx watch`) and Vite frontend build concurrently. Server logs go to `logs/server.log`. Open [http://localhost:3000](http://localhost:3000) and sign in with Google.

## Scripts

| Command | Description |
|---------|-------------|
| `./scripts/run_dev.sh` | Start dev server (migrations + watch) |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm test` | Run tests |
| `pnpm lint` | Lint with Biome |
| `pnpm db:generate` | Generate Drizzle migration |
| `pnpm db:migrate` | Run pending migrations |
| `pnpm db:studio` | Open Drizzle Studio |

## Security

- JWT session cookies (httpOnly, SameSite=Strict)
- CSRF protection on all state-changing requests
- OAuth tokens encrypted at rest (AES-256-GCM)
- Email allowlist restricts who can sign in
- User ID threaded through all queries (multi-tenant isolation)
- Internal errors never exposed to clients

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Tailwind CSS 4, Radix UI, Vite |
| Backend | Hono, Node.js, WebSocket |
| Agent | Claude Agent SDK, MCP tools |
| Database | PostgreSQL 16, Drizzle ORM |
| Auth | Google OAuth 2.0, JWT, CSRF |
| Google APIs | googleapis SDK (Gmail, Calendar, Drive) |
| Testing | Vitest |
| Linting | Biome, custom architecture lints |
