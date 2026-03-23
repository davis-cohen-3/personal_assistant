FROM node:22-slim AS base
RUN apt-get update && apt-get install -y git --no-install-recommends && rm -rf /var/lib/apt/lists/*
RUN corepack enable pnpm

# --- Build stage ---
FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# --- Production stage ---
FROM base AS production
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/server/db/migrations ./src/server/db/migrations
COPY drizzle.config.ts ./

# Claude Agent SDK spawns a Claude Code CLI subprocess that needs writable dirs.
# Cloud Run filesystem is read-only except /tmp.
ENV HOME=/tmp
ENV XDG_CONFIG_HOME=/tmp/.config
ENV XDG_CACHE_HOME=/tmp/.cache
ENV XDG_DATA_HOME=/tmp/.local/share
RUN useradd -m -s /bin/sh appuser && \
    mkdir -p /tmp/.config /tmp/.cache /tmp/.local/share && \
    chown -R appuser:appuser /tmp/.config /tmp/.cache /tmp/.local/share /app
USER appuser

EXPOSE 8080
ENV PORT=8080
CMD ["sh", "-c", "npx drizzle-kit migrate && node dist/server/index.js"]
