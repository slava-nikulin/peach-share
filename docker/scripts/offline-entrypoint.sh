#!/usr/bin/env sh
set -euo pipefail

PORT="${PORT:-5173}"
MODE="${MODE:-emu}"
ROOT_DIR="${ROOT_DIR:-/app/dist}"

# Пытаемся получить IP хоста
HOST_IP="$(getent hosts host.docker.internal 2>/dev/null | awk '{print $1}')"

# Фолбэк: берём исходящий IP интерфейса по умолчанию
if [ -z "$HOST_IP" ]; then
  HOST_IP="$(ip route get 1.1.1.1 2>/dev/null \
    | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
fi

echo "Static bundle mode: ${MODE}"
echo "Static server root: ${ROOT_DIR}"
echo "HTTP server will listen on 0.0.0.0:${PORT}"
[ -n "$HOST_IP" ] && echo "LAN URL:  http://${HOST_IP}:${PORT}"
echo "Local URL: http://localhost:${PORT}"

exec node ./docker/scripts/serve-dist.mjs --root="${ROOT_DIR}" --port="${PORT}" --mode="${MODE}"
