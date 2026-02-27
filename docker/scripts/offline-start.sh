#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT="peachshare-offline"
BASE_FILE="docker/docker-compose.base.yml"
OFFLINE_FILE="docker/docker-compose.offline.yml"
COMPOSE_UP_FLAGS="${COMPOSE_UP_FLAGS:---force-recreate --remove-orphans}"
COMPOSE_PULL_MODE="${COMPOSE_PULL_MODE:-}"

get_host_ip() {
  local ip
  ip="$(
    ip -4 -o addr show scope global | awk '
      $2 ~ /^wl/ {
        split($4, a, "/"); ip=a[1];
        if (ip ~ /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/) {
          print ip; exit
        }
      }
    '
  )"

  if [[ -z "$ip" ]]; then
    ip="$(
      ip -4 -o addr show scope global | awk '
        $2 !~ /^(lo|docker|br-|veth|tun|tap)/ {
          split($4, a, "/"); ip=a[1];
          if (ip ~ /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/) {
            print ip; exit
          }
        }
      '
    )"
  fi

  echo "$ip"
}

main() {
  local action="${1:-up}"

  if [[ "$action" == "stop" ]]; then
    docker compose -p "$PROJECT" -f "$BASE_FILE" -f "$OFFLINE_FILE" --profile offline down
    exit 0
  fi

  local HOST_IP
  HOST_IP="$(get_host_ip)"
  if [[ -z "$HOST_IP" ]]; then
    echo "could not determine IPv4" >&2
    exit 1
  fi

  shift || true

  set -- up "$@"

  if [ -n "$COMPOSE_PULL_MODE" ]; then
    set -- "$@" --pull "$COMPOSE_PULL_MODE"
  fi

  # Разворачиваем флаги из строки в массив
  # shellcheck disable=SC2206
  local flags=( $COMPOSE_UP_FLAGS )
  set -- "$@" "${flags[@]}"

  HOST_LAN_IP="$HOST_IP" \
    docker compose -p "$PROJECT" -f "$BASE_FILE" -f "$OFFLINE_FILE" --profile offline "$@"
}

main "$@"