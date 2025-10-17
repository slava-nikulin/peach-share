#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile

# ждём web
until [ "$(curl -s -o /dev/null -w "%{http_code}" http://web:5173)" = "200" ]; do
  echo "waiting for web:5173..."; sleep 0.5
done

echo "----Running tests---"

# only Chromium и headed
CMD=(pnpm exec playwright test --reporter=line --project=chromium)
if [ "${HEADED:-0}" = "1" ]; then CMD+=("--headed"); fi
if [ "${PWDEBUG:-0}" = "1" ]; then export PWDEBUG=1; fi

if [ "${HEADED:-0}" = "1" ]; then
  export DISPLAY=${DISPLAY:-:99}
  VNC_PORT=${VNC_PORT:-5900}
  VNC_GEOMETRY=${VNC_GEOMETRY:-1920x1080x24}

  pids=()

  # Xvfb
  Xvfb "$DISPLAY" -screen 0 "$VNC_GEOMETRY" -ac +extension RANDR &
  pids+=($!)

  # WM (обязательно для нормальных окон)
  fluxbox >/dev/null 2>&1 &
  pids+=($!)

  # VNC-сервер
  x11vnc -display "$DISPLAY" -rfbport "$VNC_PORT" -forever -shared -nopw -quiet >/dev/null 2>&1 &
  pids+=($!)

  # аккуратная остановка
  trap 'kill -15 ${pids[@]} 2>/dev/null || true' EXIT

  # чуть подождать чтобы VNC успел подняться
  sleep 1
fi

exec "${CMD[@]}"
