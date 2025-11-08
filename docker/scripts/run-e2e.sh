#!/bin/bash
set -euo pipefail

PROJECT_NAME="peachshare-e2e"
COMPOSE_FILES="-f docker/docker-compose.base.yml -f docker/docker-compose.e2e.yml"
EXIT_CODE=0

cleanup() {
    echo "🧹 Cleanup..."
    docker compose -p "$PROJECT_NAME" $COMPOSE_FILES \
        --profile e2e \
        down --remove-orphans -v
    
    echo "Exit code: $EXIT_CODE"
}
trap cleanup EXIT INT TERM

docker compose -p "$PROJECT_NAME" $COMPOSE_FILES \
    --profile e2e \
    up --build --abort-on-container-exit --exit-code-from e2e-tests \
    || EXIT_CODE=$?

exit $EXIT_CODE