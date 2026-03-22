#!/bin/bash
set -e
mkdir -p logs
> logs/server.log

set -a && source .env && set +a

# Kill anything holding port 3000 from a previous run
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

npx drizzle-kit migrate

trap 'kill 0' SIGINT SIGTERM EXIT

npx concurrently --kill-others \
  "npx tsx watch src/server/index.ts >> logs/server.log 2>&1" \
  "vite build --watch 2>/dev/null"
