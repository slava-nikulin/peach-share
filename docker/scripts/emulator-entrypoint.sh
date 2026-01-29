#!/usr/bin/env sh
set -euo pipefail

exec firebase emulators:start \
  --only database,auth,functions \
  --project "demo-peach-share" \
  --config /app/config/firebase.json