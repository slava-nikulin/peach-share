# install.sh  -> запуск:  curl -fsSL https://example.com/install.sh | bash
#!/usr/bin/env bash
set -euo pipefail

# 1) где лежит актуальный compose (raw)
COMPOSE_URL="${COMPOSE_URL:-https://example.com/docker-compose.yml}"        # обязателен
OVERRIDE_URL="${OVERRIDE_URL:-}"                                            # опционально (dev-override)

# 2) проверки
command -v docker >/dev/null || { echo "docker не найден"; exit 1; }
if docker compose version >/dev/null 2>&1; then DC_BIN="docker compose";
elif command -v docker-compose >/dev/null 2>&1; then DC_BIN="docker-compose";
else echo "docker compose не найден"; exit 1; fi
command -v base64 >/dev/null || { echo "base64 не найден"; exit 1; }

# 3) тянем compose(+override) и кодируем в base64 (без переводов строк)
tmp_base="$(mktemp)"; curl -fsSL "$COMPOSE_URL" -o "$tmp_base"
COMPOSE_B64="$(base64 < "$tmp_base" | tr -d '\n')"; rm -f "$tmp_base"

OVR_B64=""
if [ -n "$OVERRIDE_URL" ]; then
  tmp_ovr="$(mktemp)"; curl -fsSL "$OVERRIDE_URL" -o "$tmp_ovr"
  OVR_B64="$(base64 < "$tmp_ovr" | tr -d '\n')"; rm -f "$tmp_ovr"
fi

# 4) генерим start-peach.sh с зашитым compose
cat > start-peach.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

# ==== параметры, которые можно править перед запуском ====
: "${REG:=ghcr.io}"                 # реестр
: "${ORG:=your-org}"                # организация/юзер
: "${TAG:=1.0.0}"                   # тег образов
: "${PROJECT_ID:=demo-peach-share}" # namespace RTDB эмулятора
: "${WEB_PORT:=80}"                 # порт веба на хосте
: "${UI_PORT:=4000}"                # порт Emulator UI на хосте
: "${DB_PORT:=9000}"                # порт RTDB на хосте
: "${AUTH_PORT:=9099}"              # порт Auth на хосте
export REG ORG TAG PROJECT_ID WEB_PORT UI_PORT DB_PORT AUTH_PORT

# docker compose бинарь
if docker compose version >/dev/null 2>&1; then DC="docker compose";
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose";
else echo "docker compose не найден"; exit 1; fi

# ====== встроенный compose в base64 (подставит install.sh) ======
COMPOSE_B64="__COMPOSE_B64__"
OVR_B64="__OVR_B64__"   # может быть пустым

# функция decode с кроссплатформенной опцией (-d / -D)
decode_b64() {
  if echo -n "$1" | base64 -d >/dev/null 2>&1; then
    echo -n "$1" | base64 -d
  else
    echo -n "$1" | base64 -D
  fi
}

BASE_FILE="$(mktemp)"; trap 'rm -f "$BASE_FILE" "$OVR_FILE"' EXIT
decode_b64 "$COMPOSE_B64" > "$BASE_FILE"

OVR_FILE=""
if [ -n "$OVR_B64" ]; then
  OVR_FILE="$(mktemp)"
  decode_b64 "$OVR_B64" > "$OVR_FILE"
fi

cmd="${1:-up}"
case "$cmd" in
  up)         [ -n "$OVR_FILE" ] && exec $DC -f "$BASE_FILE" -f "$OVR_FILE" up -d --pull always || exec $DC -f "$BASE_FILE" up -d --pull always ;;
  down)       exec $DC -f "$BASE_FILE" ${OVR_FILE:+-f "$OVR_FILE"} down ;;
  pull)       exec $DC -f "$BASE_FILE" ${OVR_FILE:+-f "$OVR_FILE"} pull ;;
  logs)       exec $DC -f "$BASE_FILE" ${OVR_FILE:+-f "$OVR_FILE"} logs -f ;;
  ps)         exec $DC -f "$BASE_FILE" ${OVR_FILE:+-f "$OVR_FILE"} ps ;;
  stop)       exec $DC -f "$BASE_FILE" ${OVR_FILE:+-f "$OVR_FILE"} stop ;;
  uninstall)  $DC -f "$BASE_FILE" ${OVR_FILE:+-f "$OVR_FILE"} down -v || true ;;
  *)          echo "usage: ./start-peach.sh [up|down|pull|logs|ps|stop|uninstall]"; exit 2 ;;
esac
SCRIPT

# 5) подставляем b64-пэйлоады
sed -i.bak "s|__COMPOSE_B64__|${COMPOSE_B64}|g" start-peach.sh && rm -f start-peach.sh.bak
sed -i.bak "s|__OVR_B64__|${OVR_B64}|g" start-peach.sh && rm -f start-peach.sh.bak
chmod +x start-peach.sh

# 6) первый запуск
./start-peach.sh up
echo "Готово. Web: http://localhost  | Emulator UI: http://localhost:${UI_PORT:-4000}"
