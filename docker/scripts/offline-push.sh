#!/usr/bin/env sh
set -euo pipefail

DEFAULT_REPO="${GITHUB_REPOSITORY:-slava-nikulin/peach-share}"
DEFAULT_OWNER="${DEFAULT_REPO%%/*}"
DEFAULT_NAME="${DEFAULT_REPO#*/}"
if [ "$DEFAULT_NAME" = "$DEFAULT_REPO" ]; then
  DEFAULT_OWNER="slava-nikulin"
  DEFAULT_NAME="peach-share"
fi
OWNER="${OWNER:-$DEFAULT_OWNER}"
REPO="${REPO:-$DEFAULT_NAME}"
TAG="${1:-emu}"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(realpath "$SCRIPT_DIR/../..")"
WEB_DF="$REPO_ROOT/docker/Dockerfile.web.offline"
RTDB_DF="$REPO_ROOT/docker/Dockerfile.firebase.offline"
PROXY_DF="$REPO_ROOT/docker/Dockerfile.proxy.offline"

[ -f "$WEB_DF" ] || { echo "No $WEB_DF"; exit 1; }
[ -f "$RTDB_DF" ] || { echo "No $RTDB_DF"; exit 1; }
[ -f "$PROXY_DF" ] || { echo "No $PROXY_DF"; exit 1; }

# echo "$GH_PAT" | docker login ghcr.io -u slava-nikulin --password-stdin

docker buildx build -f "$WEB_DF" -t "ghcr.io/$OWNER/$REPO/web-offline:$TAG" "$REPO_ROOT"
docker buildx build -f "$RTDB_DF" -t "ghcr.io/$OWNER/$REPO/rtdb-emulator-offline:$TAG" "$REPO_ROOT"
docker buildx build -f "$PROXY_DF" -t "ghcr.io/$OWNER/$REPO/proxy:$TAG" "$REPO_ROOT"

echo "Built images:"
echo "  ghcr.io/$OWNER/$REPO/web-offline:$TAG"
echo "  ghcr.io/$OWNER/$REPO/rtdb-emulator-offline:$TAG"
echo "  ghcr.io/$OWNER/$REPO/proxy:$TAG"

if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "Running in GitHub Actions. Will push."
    docker push "ghcr.io/$OWNER/$REPO/web-offline:$TAG"
    docker push "ghcr.io/$OWNER/$REPO/rtdb-emulator-offline:$TAG"
    docker push "ghcr.io/$OWNER/$REPO/proxy:$TAG"
else
    echo "Not running in GitHub Actions. Skipping push."
fi
