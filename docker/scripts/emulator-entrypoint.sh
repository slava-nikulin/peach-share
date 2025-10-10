#!/usr/bin/env sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-demo-peach-share}"

exec firebase emulators:start \
  --only database,auth \
  --project "$PROJECT_ID" \
  --config /app/config/firebase.json