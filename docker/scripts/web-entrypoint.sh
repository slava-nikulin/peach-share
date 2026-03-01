#!/usr/bin/env sh
set -euo pipefail

MODE="${MODE:-emu}"

# Install deps inside container so native optional binaries match container OS/arch.
pnpm install --frozen-lockfile --prefer-offline --filter peach-share...

if [ "$MODE" = "offline" ]; then
  pnpm exec vite build --mode offline
  exec pnpm exec vite preview --mode offline --host 0.0.0.0 --port 5173 --strictPort
fi

exec pnpm exec vite --host 0.0.0.0 --port 5173 --strictPort --mode "$MODE"
