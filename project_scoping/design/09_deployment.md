# Deployment & DevOps

## Overview

Railway deployment. Single service (Node.js) + Railway Postgres plugin. HTTPS and subdomain provided by the platform. Scale-to-zero keeps costs minimal — the app only runs when a user is active.

---

## Platform: Railway

| | |
|---|---|
| **Plan** | Hobby ($5/month, usage-based) |
| **App URL** | `https://<app-name>.up.railway.app` |
| **HTTPS** | Automatic (Railway-managed TLS) |
| **WebSocket** | Supported out of the box |
| **Deploy trigger** | Push to `main` on GitHub |
| **Scale-to-zero** | Enabled — service sleeps after inactivity, wakes on first request |

### Why Railway

- Cheapest always-available option with scale-to-zero (pay only for active compute)
- Native Postgres plugin (no separate hosting)
- Free subdomain (no custom domain needed)
- WebSocket support without extra config
- Simple GitHub integration — push to deploy

---

## Services

### 1. App Service (Node.js)

Runs the built Hono server which serves the API, WebSocket, and static frontend.

```
Build command:   pnpm run build && pnpm drizzle-kit migrate
Start command:   pnpm run start
```

Railway auto-detects Node.js and pnpm (via `pnpm-lock.yaml`). The `start` script runs `node dist/server/index.js`. Migrations run at the end of the build step so schema changes are applied before the new version starts.

**Resource limits (Hobby plan defaults):**
- 8 GB RAM, 8 vCPU (burst)
- 100 GB outbound bandwidth/month
- Scale-to-zero after ~5 minutes of no inbound requests — kills active WebSocket connections and agent sessions. The frontend handles this with a "Connection lost" banner and reconnect flow (see `05_frontend.md`). SDK session context (agent working memory) is lost on scale-to-zero; the agent starts with a fresh context. Chat message history is preserved in Postgres and remains visible in the UI.

### 2. Postgres (Railway Plugin)

Railway's managed Postgres. Provisioned via the dashboard — no Docker container needed.

| | |
|---|---|
| **Version** | Postgres 16 |
| **Storage** | 1 GB included on Hobby (expandable) |
| **Connection** | `DATABASE_URL` injected automatically as a Railway variable |
| **Backups** | Point-in-time recovery on Hobby plan |

No `docker-compose.yml` needed in production. The compose file is dev-only.

---

## Environment Variables

Set in Railway dashboard → service → Variables tab.

```
# Auth
ALLOWED_USERS=davis@gmail.com
JWT_SECRET=<generate with: openssl rand -hex 32>

# Database (auto-injected by Railway Postgres plugin)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Google OAuth
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
GOOGLE_REDIRECT_URI=https://<app-name>.up.railway.app/auth/google/callback

# Agent
ANTHROPIC_API_KEY=<your API key>

# Encryption
ENCRYPTION_KEY=<generate with: openssl rand -hex 32>

# Port (Railway sets this automatically, Hono reads it)
PORT=3000
```

### Google Token Persistence

Google OAuth tokens are stored in the `google_tokens` Postgres table (see `03_data_layer.md`). This survives Railway's ephemeral filesystem across deploys. `src/server/google/auth.ts` upserts tokens on every refresh — no env var or filesystem path needed.

---

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URI: `https://<app-name>.up.railway.app/auth/google/callback`
4. Copy Client ID and Client Secret into Railway env vars
5. Enable APIs: Gmail API, Google Calendar API, Google Drive API

For local dev, add `http://localhost:3000/auth/google/callback` as a second redirect URI.

---

## Deploy Pipeline

### Automatic (push to main)

```
git push origin main
    → Railway detects push
    → Runs: pnpm run build (vite build + tsc)
    → Starts: pnpm run start (node dist/server/index.js)
    → Health check passes → traffic routed
```

Railway does rolling deploys — the old instance stays up until the new one is healthy.

### Manual / First Deploy

1. Create a Railway project
2. Connect GitHub repo
3. Add Postgres plugin
4. Set environment variables (see above)
5. Deploy

---

## Local Dev vs Production

| Concern | Local Dev | Production (Railway) |
|---|---|---|
| **Postgres** | Docker container via `docker-compose.yml` | Railway Postgres plugin |
| **Frontend** | Vite dev server with HMR (port 5173) | Static files served by Hono |
| **Backend** | `tsx watch` with live reload | `node dist/server/index.js` |
| **HTTPS** | Not needed (localhost) | Railway-managed TLS |
| **Google tokens** | Postgres (same as prod) | Postgres |
| **OAuth redirect** | `http://localhost:3000/auth/google/callback` | `https://<app>.up.railway.app/auth/google/callback` |

---

## Monitoring & Logs

Railway provides:
- **Deploy logs** — build output, start logs
- **Runtime logs** — stdout/stderr from the Node process (accessible via dashboard or `railway logs`)
- **Metrics** — CPU, memory, network (dashboard)

No external monitoring needed for v1. If the app crashes, Railway auto-restarts. `console.error`/`console.warn` output shows up in Railway's log viewer — no external logging library needed.

---

## Cost Estimate

| Component | Cost |
|---|---|
| Railway Hobby plan | $5/month base |
| Compute (scale-to-zero) | ~$1-3/month for light personal use |
| Postgres | Included in Hobby plan |
| Anthropic API | Usage-based (~$5-20/month depending on volume) |
| Google APIs | Free (Gmail/Calendar/Drive within quota) |
| Domain / TLS | Free (Railway subdomain) |
| **Total** | **~$10-30/month** |
