# Deployment & DevOps

## Overview

GCP Cloud Run deployment. Containerized Node.js service + Cloud SQL Postgres. HTTPS and URL provided by the platform. Scale-to-zero keeps costs minimal — the app only runs when a user is active.

---

## Platform: GCP Cloud Run

| | |
|---|---|
| **Project** | `double-dolphin-490920-m6` |
| **Service** | `pa-agent` |
| **Region** | `us-central1` |
| **App URL** | `https://pa-agent-1055755006774.us-central1.run.app` |
| **HTTPS** | Automatic (Google-managed TLS) |
| **WebSocket** | Supported out of the box |
| **Deploy trigger** | Manual via `gcloud run deploy` |
| **Scale-to-zero** | Enabled — service sleeps after inactivity, wakes on first request |

### Why GCP Cloud Run

- Pay-per-use with scale-to-zero (no cost when idle)
- Container-based — reproducible builds via Dockerfile
- Native HTTPS with no config
- WebSocket support without extra config
- Integrated with Cloud SQL, Cloud Logging, and Secret Manager

---

## Services

### 1. App Service (Docker container)

Runs the built Hono server which serves the API, WebSocket, and static frontend. See `Dockerfile` at project root.

```
Build: docker build → push to Artifact Registry (or --source . with Cloud Build)
Start: CMD ["sh", "-c", "npx drizzle-kit migrate && node dist/server/index.js"]
Port:  8080 (Cloud Run default)
```

Migrations run at container startup before the server starts — schema changes are applied before traffic is served.

**Resource config:**
- Memory: 512Mi–1Gi (configurable)
- CPU: 1 (scales with concurrency)
- Scale-to-zero after inactivity — kills active WebSocket connections and agent sessions. The frontend handles this with a "Connection lost" banner and reconnect flow (see `05_frontend.md`). SDK session context (agent working memory) is lost on scale-to-zero; the agent starts with a fresh context. Chat message history is preserved in Postgres and remains visible in the UI.

### 2. Postgres (Cloud SQL)

Cloud SQL managed Postgres. Provisioned via GCP Cloud Console.

| | |
|---|---|
| **Version** | Postgres 16 |
| **Connection** | `DATABASE_URL` set as Cloud Run environment variable |
| **Backups** | Automated daily backups via Cloud SQL |

No `docker-compose.yml` needed in production. The compose file is dev-only.

---

## Environment Variables

Set via GCP Cloud Console → Cloud Run → `pa-agent` → Edit & Deploy → Variables & Secrets tab, or via:

```bash
gcloud run services update pa-agent \
  --region us-central1 \
  --update-env-vars KEY=VALUE
```

```
# Auth
ALLOWED_USERS=davis@gmail.com
JWT_SECRET=<generate with: openssl rand -hex 32>

# Database
DATABASE_URL=<Cloud SQL connection string>

# Google OAuth
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
GOOGLE_REDIRECT_URI=https://pa-agent-1055755006774.us-central1.run.app/auth/google/callback

# Agent
ANTHROPIC_API_KEY=<your API key>

# Encryption
ENCRYPTION_KEY=<generate with: openssl rand -hex 32>

# Port (Cloud Run sets this automatically)
PORT=8080
```

### Google Token Persistence

Google OAuth tokens are stored in the `google_tokens` Postgres table (see `03_data_layer.md`). This survives Cloud Run's ephemeral filesystem across deploys. `src/server/google/auth.ts` upserts tokens on every refresh — no env var or filesystem path needed.

---

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URI: `https://pa-agent-1055755006774.us-central1.run.app/auth/google/callback`
4. Copy Client ID and Client Secret into Cloud Run env vars
5. Enable APIs: Gmail API, Google Calendar API, Google Drive API

For local dev, add `http://localhost:3000/auth/google/callback` as a second redirect URI.

---

## Deploy Pipeline

### Deploy command

```bash
gcloud run deploy pa-agent \
  --source . \
  --region us-central1 \
  --project double-dolphin-490920-m6 \
  --allow-unauthenticated
```

This builds the Docker image via Cloud Build, pushes to Artifact Registry, and deploys to Cloud Run. Cloud Run does rolling deploys — the old instance stays up until the new one is healthy.

### First-time setup

1. Create a GCP project
2. Enable Cloud Run, Cloud Build, Artifact Registry APIs
3. Provision Cloud SQL Postgres instance
4. Set environment variables on the service
5. Run `gcloud run deploy` (see above)

---

## Local Dev vs Production

| Concern | Local Dev | Production (GCP Cloud Run) |
|---|---|---|
| **Postgres** | Homebrew Postgres (`postgresql://daviscohen@localhost:5432/pa_agent`) | Cloud SQL |
| **Frontend** | Vite dev server with HMR (port 5173) | Static files served by Hono |
| **Backend** | `tsx watch` with live reload | `node dist/server/index.js` |
| **HTTPS** | Not needed (localhost) | Google-managed TLS |
| **Google tokens** | Postgres (same as prod) | Postgres |
| **OAuth redirect** | `http://localhost:3000/auth/google/callback` | `https://pa-agent-1055755006774.us-central1.run.app/auth/google/callback` |

---

## Monitoring & Logs

GCP provides:
- **Deploy logs** — Cloud Build output
- **Runtime logs** — stdout/stderr from the Node process via Cloud Logging (`gcloud run logs read --service pa-agent --region us-central1`)
- **Metrics** — CPU, memory, request count via Cloud Monitoring

No external monitoring needed for v1. If the app crashes, Cloud Run auto-restarts. `console.error`/`console.warn` output shows up in GCP Cloud Logging — no external logging library needed.

---

## Cost Estimate

| Component | Cost |
|---|---|
| Cloud Run compute | ~$0–2/month (scale-to-zero, light personal use) |
| Cloud SQL | ~$7–10/month (db-f1-micro) |
| Anthropic API | Usage-based (~$5-20/month depending on volume) |
| Google APIs | Free (Gmail/Calendar/Drive within quota) |
| Domain / TLS | Free (Cloud Run URL) |
| **Total** | **~$10-30/month** |
