#!/usr/bin/env bash
# wifi-ap-min-daemon.sh — disposable AP via NetworkManager (Ubuntu/Manjaro)
# Запуск и остановка по Ctrl+C. Профили не сохраняются на диск.
set -Eeuo pipefail

DEBUG=0 TRACE=0 TEE=0
NM_TIMEOUT_ADD=10
NM_TIMEOUT_UP=20
NM_TIMEOUT_MOD=10
DEV_TIMEOUT_DISC=5

out(){ echo "$1"; ((TEE)) && echo "$1" >&2; return 0; }
fail(){ out "status: FAIL"; out "reason: $*"; exit 1; }
dbg(){ [[ $DEBUG -eq 1 ]] && echo "[DBG $(date +%H:%M:%S)] $*" >&2; return 0; }
have(){ command -v "$1" >/dev/null 2>&1; }

TIMEOUT_BIN="$(command -v timeout || true)"
run(){ local t="$1"; shift; if [[ -n "$TIMEOUT_BIN" ]]; then dbg "RUN t=$t $*"; timeout "$t" "$@"; else dbg "RUN $*"; "$@"; fi; }

# состояние для уборки
CREATED_UUID=""; CREATED_NAME=""; CREATED_IFACE=""; SLEEP_PID=""

# ловушки
setup_err(){ local line="${BASH_LINENO[0]}" rc="$?"; dbg "ERR line=$line rc=$rc uuid=$CREATED_UUID"; _cleanup; out "status: FAIL"; out "reason: unexpected error at line $line (rc=$rc)"; exit "$rc"; }
trap 'setup_err' ERR

_cleanup(){
  # 1. убить sleep, чтобы не висел процесс демона
  if [[ -n "${SLEEP_PID:-}" ]]; then
    kill "$SLEEP_PID" >/dev/null 2>&1 || true
    wait "$SLEEP_PID" 2>/dev/null || true
    SLEEP_PID=""
  fi

  # 2. на всякий случай отцепить интерфейс от AP
  if [[ -n "${CREATED_IFACE:-}" ]]; then
    nmcli device disconnect "$CREATED_IFACE" >/dev/null 2>&1 || true
  fi

  # 3. пройти по всем подключениям myhotspot* и снести каждое
  #    важно: кавычки нормальные, awk внутри одинарных кавычек
  while IFS=$'\t' read -r uuid name; do
    [[ -n "$uuid" ]] || continue
    out "cleanup: deleting $name ($uuid)"

    nmcli connection down   uuid "$uuid" >/dev/null 2>&1 || true
    nmcli  connection delete uuid "$uuid"
  done < <(
    nmcli -g UUID,NAME connection show \
    | awk -F: '$2 ~ /^myhotspot/ {printf "%s\t%s\n",$1,$2}'
  )

  # 4. перезагрузить список подключений в NM
  nmcli connection reload >/dev/null 2>&1 || true
}

exit_trap(){ local rc=$?; dbg "EXIT rc=$rc uuid=$CREATED_UUID iface=$CREATED_IFACE"; _cleanup; if (( rc==130 )); then out "status: STOPPED"; fi; }
trap 'exit_trap' EXIT INT TERM

nm_ready(){
  have nmcli || fail "nmcli not found (install NetworkManager)"
  systemctl is-active --quiet NetworkManager || systemctl start NetworkManager || fail "cannot start NetworkManager"
  nmcli radio wifi on >/dev/null 2>&1 || true
  have rfkill && rfkill unblock wifi || true
}

pick_iface(){
  local out dev typ st
  out="$(nmcli -t -f DEVICE,TYPE,STATE device 2>/dev/null || true)"
  while IFS=: read -r dev typ st; do [[ "$typ" == "wifi" && "$st" == "disconnected" ]] && { echo "$dev"; return 0; }; done <<<"$out"
  while IFS=: read -r dev typ st; do [[ "$typ" == "wifi" ]] && { echo "$dev"; return 0; }; done <<<"$out"
  return 1
}

check_ap_cap(){
  if have iw; then
    iw list 2>/dev/null | awk '
      /Supported interface modes:/ {cap=1; next}
      cap && NF==0 {cap=0}
      cap && /AP$/ {found=1}
      END {exit(found?0:1)}
    ' || fail "AP mode unsupported by driver"
  fi
}

rand_suffix(){ od -vAn -N4 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' | cut -c1-6; }

get_ip(){
  local iface="$1" ip out first
  for _ in {1..25}; do
    out="$(nmcli -g IP4.ADDRESS dev show "$iface" 2>/dev/null || true)"; first="${out%%$'\n'*}"; ip="${first%%/*}"
    [[ -n "$ip" ]] && { echo "$ip"; return 0; }
    out="$(ip -4 -o addr show dev "$iface" 2>/dev/null || true)"; first="${out%%$'\n'*}"
    local a b c d e; read -r a b c d e <<<"$first"; [[ "$c" == "inet" ]] && ip="${d%%/*}"
    [[ -n "$ip" ]] && { echo "$ip"; return 0; }
    sleep 0.2
  done; echo ""
}

start_ap(){
  local SSID="" PASS="" IFACE="" CON="myhotspot" ENC=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ssid) SSID="${2:-}"; shift 2;;
      --pass|--password) PASS="${2:-}"; shift 2;;
      --iface) IFACE="${2:-}"; shift 2;;
      --name) CON="${2:-}"; shift 2;;
      --debug) DEBUG=1; shift;;
      --trace) TRACE=1; set -x; shift;;
      --tee-stderr) TEE=1; shift;;
      *) fail "unknown arg: $1";;
    esac
  done

  [[ -n "$SSID" ]] || fail "--ssid is required"
  (( ${#SSID} <= 32 )) || fail "ssid must be <=32 chars"
  [[ -n "$PASS" ]] || fail "--pass is required"
  (( ${#PASS} >= 8 && ${#PASS} <= 63 )) || fail "password must be 8-63 chars"
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "run with sudo"

  nm_ready
  check_ap_cap

  IFACE="${IFACE:-$(pick_iface)}"; [[ -n "$IFACE" ]] || fail "no wifi interface"
  dbg "iface=$IFACE name=$CON"

  # гарантируем отсутствие коллизий имен в ранних сессиях
  if nmcli -g NAME con show | awk -v n="$CON" '$0==n{e=1} END{exit(e?0:1)}'; then
    CON="${CON}-$(rand_suffix)"; dbg "renamed to $CON"
  fi

  # отцепляем всё текущее
  run ${DEV_TIMEOUT_DISC}s nmcli device disconnect "$IFACE" >/dev/null 2>&1 || true

  CREATED_NAME="$CON"; CREATED_IFACE="$IFACE"

  # создаем временный профиль и временно модифицируем (не на диск)
  run ${NM_TIMEOUT_ADD}s nmcli con add save no type wifi ifname "$IFACE" con-name "$CON" autoconnect no ssid "$SSID" >/dev/null
  run ${NM_TIMEOUT_MOD}s nmcli con modify --temporary "$CON" \
      802-11-wireless.mode ap \
      ipv4.method shared ipv6.method ignore \
      802-11-wireless-security.key-mgmt sae \
      802-11-wireless-security.pmf required \
      802-11-wireless-security.psk "$PASS" >/dev/null || true

  # пробуем WPA3, иначе WPA2-AES
  if run ${NM_TIMEOUT_UP}s nmcli con up "$CON" >/dev/null 2>&1; then
    ENC="WPA3-SAE"
  else
    nmcli -q0 con down "$CON" >/dev/null 2>&1 || true
    # пересоздаём временно
    nmcli -q0 con del "$CON" >/dev/null 2>&1 || true
    run ${NM_TIMEOUT_ADD}s nmcli con add save no type wifi ifname "$IFACE" con-name "$CON" autoconnect no ssid "$SSID" >/dev/null
    run ${NM_TIMEOUT_MOD}s nmcli con modify --temporary "$CON" \
        802-11-wireless.mode ap \
        ipv4.method shared ipv6.method ignore \
        802-11-wireless-security.key-mgmt wpa-psk \
        802-11-wireless-security.proto rsn \
        802-11-wireless-security.pairwise ccmp \
        802-11-wireless-security.group ccmp \
        802-11-wireless-security.pmf optional \
        802-11-wireless-security.psk "$PASS" >/dev/null
    run ${NM_TIMEOUT_UP}s nmcli con up "$CON" >/dev/null || fail "cannot start AP with WPA3 or WPA2"
    ENC="WPA2-PSK"
  fi

  CREATED_UUID="$(nmcli -g connection.uuid con show "$CON" 2>/dev/null || true)"

  local HOST_IP; HOST_IP="$(get_ip "$IFACE")"; [[ -n "$HOST_IP" ]] || fail "AP up but no IPv4 on $IFACE"

  out "status: OK"
  out "ssid: $SSID"
  out "iface: $IFACE"
  out "encryption: $ENC"
  out "host_ip: $HOST_IP"

  # демонизируемся: держим процесс до Ctrl+C; ERR-trap больше не нужен
  trap - ERR
  [[ $DEBUG -eq 1 ]] && echo "info: AP running. Press Ctrl+C to stop." >&2
  sleep infinity & SLEEP_PID=$!
  wait "$SLEEP_PID"
}

# интерфейс запуска
case "${1:-}" in
  --ssid|--pass|--password|--iface|--name|--debug|--trace|--tee-stderr) start_ap "$@";;
  *) fail "usage: sudo $0 --ssid <SSID> --pass <PASSWORD> [--iface wlan0] [--name myhotspot] [--tee-stderr] [--debug] [--trace]";;
esac
