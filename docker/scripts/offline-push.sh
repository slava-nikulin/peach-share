#!/usr/bin/env sh
set -euo pipefail

OWNER="${OWNER:-slava-nikulin}"
REPO="${REPO:-peach-share}"
TAG="${1:-emu}"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(realpath "$SCRIPT_DIR/../..")"
WEB_DF="$REPO_ROOT/docker/Dockerfile.web.offline"
RTDB_DF="$REPO_ROOT/docker/Dockerfile.firebase.offline"

[ -f "$WEB_DF" ] || { echo "No $WEB_DF"; exit 1; }
[ -f "$RTDB_DF" ] || { echo "No $RTDB_DF"; exit 1; }

# echo "$GH_PAT" | docker login ghcr.io -u slava-nikulin --password-stdin

docker build -f "$WEB_DF" -t "ghcr.io/$OWNER/$REPO/web-offline:$TAG" "$REPO_ROOT"
docker build -f "$RTDB_DF" -t "ghcr.io/$OWNER/$REPO/rtdb-emulator-offline:$TAG" "$REPO_ROOT"

docker push "ghcr.io/$OWNER/$REPO/web-offline:$TAG"
docker push "ghcr.io/$OWNER/$REPO/rtdb-emulator-offline:$TAG"
