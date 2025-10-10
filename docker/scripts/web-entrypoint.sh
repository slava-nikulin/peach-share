#!/usr/bin/env sh
set -euo pipefail

if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile
else
  pnpm install
fi

MODE="${MODE:-emu}"

exec pnpm exec vite --host 0.0.0.0 --port 5173 --mode "$MODE"
