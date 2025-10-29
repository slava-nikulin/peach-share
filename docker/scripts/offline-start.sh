#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT="peachshare-offline"
COMPOSE_FILE="docker/docker-compose.offline.yml"

get_host_ip() {
  # пытаемся вытащить приватный IPv4 с Wi-Fi интерфейса (wl*)
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

  # если не нашли, fallback: любой приватный IPv4 не с loopback/docker/veth
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
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down
    exit 0
  fi

  # default: up
  local HOST_IP
  HOST_IP="$(get_host_ip)"

  if [[ -z "$HOST_IP" ]]; then
    echo "could not determine IPv4" >&2
    exit 1
  fi

  HOST_LAN_IP="$HOST_IP" docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up
}

main "$@"
