#!/usr/bin/env bash
set -euo pipefail
PROJECT_ID="${PROJECT_ID:-demo-peach-share}"
HOST_BIND="${HOST_BIND:-0.0.0.0}"
UI_PORT="${UI_PORT:-4000}"
DB_PORT="${DB_PORT:-9000}"
AUTH_PORT="${AUTH_PORT:-9099}"

cat > /app/firebase.json <<EOF
{ "database": { "rules": "database.rules.json" },
  "emulators": {
    "ui":       { "host": "${HOST_BIND}", "port": ${UI_PORT} },
    "database": { "host": "${HOST_BIND}", "port": ${DB_PORT} },
    "auth":     { "host": "${HOST_BIND}", "port": ${AUTH_PORT} }
} }
EOF

[ -f /app/database.rules.json ] || echo '{ "rules": { ".read": true, ".write": true } }' > /app/database.rules.json
export FIREBASE_DATABASE_EMULATOR_HOST="127.0.0.1:${DB_PORT}"
exec firebase emulators:start --only auth,database,ui --project "${PROJECT_ID}"
