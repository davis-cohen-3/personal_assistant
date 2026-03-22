#!/bin/bash
set -e
npx drizzle-kit migrate
npx concurrently "tsx watch src/server/index.ts" "vite"
