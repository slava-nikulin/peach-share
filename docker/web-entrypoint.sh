#!/usr/bin/env bash
set -euo pipefail

corepack enable || true

exec pnpm dev -- --host 0.0.0.0 --port 5173 --mode emu
