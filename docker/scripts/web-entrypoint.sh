#!/usr/bin/env sh
set -euo pipefail

MODE="${MODE:-emu}"

exec pnpm exec vite --host 0.0.0.0 --port 5173 --mode "$MODE"
