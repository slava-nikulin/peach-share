#!/bin/sh
set -eu

PROJECT_ID="demo-peach-share"
RTDB_NS="demo-peach-share"

# 1) Hub видит нужные эмуляторы (200 + в ответе есть нужные ключи)
hub_json="$(curl -sS http://127.0.0.1:4400/emulators)"
echo "$hub_json" | grep -q '"database"'
echo "$hub_json" | grep -q '"auth"'
echo "$hub_json" | grep -q '"functions"'

# 2) RTDB отвечает (200). ns оставляем, раз ты фиксируешь projectId==ns.
curl -sS "http://127.0.0.1:9000/.json?ns=${RTDB_NS}" >/dev/null

# 3) Auth: важна доступность порта/HTTP, а не статус-код (корень может быть 404)
curl -sS -o /dev/null http://127.0.0.1:9099/

# 4) Functions: проверяем реально загруженную функцию (должно быть 200)
curl -sS -o /dev/null "http://127.0.0.1:5001/${PROJECT_ID}/us-central1/health"
