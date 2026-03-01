#!/usr/bin/env sh
set -euo pipefail

MODE="${MODE:-emu}"

if [ "$MODE" = "offline" ]; then
  pnpm exec vite build --mode offline
  exec pnpm exec vite preview --host 0.0.0.0 --port 5173 --strictPort
fi

exec pnpm exec vite --host 0.0.0.0 --port 5173 --strictPort --mode "$MODE"
