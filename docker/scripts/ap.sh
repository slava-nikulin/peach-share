#!/usr/bin/env bash
# wifi-ap-min.sh — robust NM-based AP (Ubuntu/Manjaro)
set -Eeuo pipefail

DEBUG=0 TRACE=0
NM_TIMEOUT_ADD=10
NM_TIMEOUT_UP=20
NM_TIMEOUT_MOD=10
DEV_TIMEOUT_DISC=5

fail(){ echo "status: FAIL"; echo "reason: $*"; exit 1; }
dbg(){ [[ $DEBUG -eq 1 ]] && echo "[DBG $(date +%H:%M:%S)] $*" >&2; }
have(){ command -v "$1" >/dev/null 2>&1; }
TIMEOUT_BIN="$(command -v timeout || true)"
run(){ local t="$1"; shift; if [[ -n "$TIMEOUT_BIN" ]]; then dbg "RUN($t): $*"; "$TIMEOUT_BIN" "$t" "$@"; else dbg "RUN(no-timeout,$t): $*"; "$@"; fi; }

# печатаем краткую причину даже без --debug
trap 'rc=$?; line=${BASH_LINENO[0]}; cmd=${BASH_COMMAND}; [[ $DEBUG -eq 1 ]] && dbg "ERR line=$line rc=$rc cmd=$cmd"; echo "status: FAIL"; echo "reason: unexpected error at line $line: $cmd (rc=$rc)"; exit $rc' ERR

nm_ready(){
  have nmcli || fail "nmcli not found (install NetworkManager)"
  systemctl is-active --quiet NetworkManager || { dbg "start NM"; systemctl start NetworkManager; }
  nmcli radio wifi on >/dev/null 2>&1 || true
  have rfkill && rfkill unblock wifi || true
}

pick_iface(){ nmcli -t -f DEVICE,TYPE device status | awk -F: '$2=="wifi"{print $1; exit}'; }

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

purge_by_name(){
  local name="$1" loop=0
  while :; do
    mapfile -t uuids < <(nmcli -g UUID,NAME connection show | awk -F: -v n="$name" '$2==n{print $1}')
    ((${#uuids[@]}==0)) && break
    for u in "${uuids[@]}"; do
      [[ -n "$u" ]] || continue
      nmcli -q0 connection down uuid "$u" >/dev/null 2>&1 || true
      nmcli -q0 connection delete uuid "$u" >/dev/null 2>&1 || true
    done
    ((loop++>5)) && break
    sleep 0.1
  done
  nmcli connection reload >/dev/null 2>&1 || true
}

name_exists(){ nmcli -g NAME connection show | awk -v n="$1" '$0==n{e=1} END{exit(e?0:1)}'; }

get_ip(){
  local iface="$1" ip=""
  for _ in {1..25}; do
    ip="$(nmcli -g IP4.ADDRESS dev show "$iface" 2>/dev/null | head -n1 | cut -d/ -f1)"
    [[ -n "$ip" ]] && { echo "$ip"; return 0; }
    ip=$(ip -4 -o addr show dev "$iface" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n1)
    [[ -n "$ip" ]] && { echo "$ip"; return 0; }
    sleep 0.2
  done
  echo ""
}

maybe_lock(){
  if have flock; then
    exec {LOCKFD}<>/run/lock/wifi-ap-min.lock 2>/dev/null || exec {LOCKFD}<>/tmp/wifi-ap-min.lock
    flock -n "$LOCKFD" || fail "another instance is running"
  fi
}

start_ap(){
  local SSID="" PASS="" IFACE="" CON="myhotspot"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ssid) SSID="${2:-}"; shift 2;;
      --pass|--password) PASS="${2:-}"; shift 2;;
      --iface) IFACE="${2:-}"; shift 2;;
      --name) CON="${2:-}"; shift 2;;
      --debug) DEBUG=1; shift;;
      --trace) TRACE=1; shift;;
      *) fail "unknown arg: $1";;
    esac
  done
  [[ -n "$SSID" ]] || fail "--ssid is required"
  [[ -n "$PASS" ]] || fail "--pass is required"
  [[ ${#PASS} -ge 8 && ${#PASS} -le 63 ]] || fail "password must be 8–63 chars"
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "run with sudo"
  [[ $TRACE -eq 1 ]] && { export PS4='+ [TRACE $(date "+%H:%M:%S")] '; set -x; }

  maybe_lock
  nm_ready
  check_ap_cap

  IFACE="${IFACE:-$(pick_iface)}"
  run ${DEV_TIMEOUT_DISC}s nmcli device disconnect "$IFACE" >/dev/null 2>&1 || true

  purge_by_name "$CON"
  if name_exists "$CON"; then CON="${CON}-$(date +%s)"; fi

  # WPA3-SAE first (PMF required)
  run ${NM_TIMEOUT_ADD}s nmcli connection add type wifi ifname "$IFACE" con-name "$CON" autoconnect no ssid "$SSID" >/dev/null
  run ${NM_TIMEOUT_MOD}s nmcli connection modify "$CON" \
      802-11-wireless.mode ap \
      ipv4.method shared ipv6.method ignore \
      802-11-wireless-security.key-mgmt sae \
      802-11-wireless-security.pmf required \
      802-11-wireless-security.psk "$PASS" >/dev/null

  if run ${NM_TIMEOUT_UP}s nmcli connection up "$CON" >/dev/null 2>&1; then
    ENC="WPA3-SAE"
  else
    # fallback WPA2-PSK
    purge_by_name "$CON"
    run ${NM_TIMEOUT_ADD}s nmcli connection add type wifi ifname "$IFACE" con-name "$CON" autoconnect no ssid "$SSID" >/dev/null
    run ${NM_TIMEOUT_MOD}s nmcli connection modify "$CON" \
        802-11-wireless.mode ap \
        ipv4.method shared ipv6.method ignore \
        802-11-wireless-security.key-mgmt wpa-psk \
        802-11-wireless-security.pmf optional \
        802-11-wireless-security.psk "$PASS" >/dev/null
    run ${NM_TIMEOUT_UP}s nmcli connection up "$CON" >/dev/null || fail "cannot start AP with WPA3 or WPA2"
    ENC="WPA2-PSK"
  fi

  local HOST_IP
  HOST_IP="$(get_ip "$IFACE")"
  [[ -n "$HOST_IP" ]] || fail "AP up but no IPv4 on $IFACE"

  echo "status: OK"
  echo "encryption: $ENC"
  echo "host_ip: $HOST_IP"
}

stop_ap(){
  local CON="myhotspot" IFACES=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name) CON="${2:-}"; shift 2;;
      --debug) DEBUG=1; shift;;
      --trace) TRACE=1; shift;;
      *) fail "unknown arg: $1";;
    esac
  done
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "run with sudo"
  have nmcli || fail "nmcli not found"
  [[ $TRACE -eq 1 ]] && { export PS4='+ [TRACE $(date "+%H:%M:%S")] '; set -x; }

  # collect ifaces tied to this connection name
  mapfile -t uuids < <(nmcli -g UUID,NAME connection show | awk -F: -v n="$CON" '$2==n{print $1}')
  for u in "${uuids[@]}"; do
    [[ -n "$u" ]] || continue
    ifname="$(nmcli -g connection.interface-name connection show uuid "$u" 2>/dev/null | head -n1)"
    [[ -n "$ifname" ]] && IFACES+=("$ifname")
    nmcli -q0 connection down uuid "$u" >/dev/null 2>&1 || true
    nmcli -q0 connection delete uuid "$u" >/dev/null 2>&1 || true
  done

  # fallback: if no iface captured, consider all wifi ifaces
  if ((${#IFACES[@]}==0)); then
    mapfile -t IFACES < <(nmcli -t -f DEVICE,TYPE device status | awk -F: '$2=="wifi"{print $1}')
  fi
  # unique and disconnect
  declare -A seen
  for d in "${IFACES[@]}"; do
    [[ -n "$d" ]] || continue
    [[ -n "${seen[$d]:-}" ]] && continue
    seen[$d]=1
    nmcli device disconnect "$d" >/dev/null 2>&1 || true
  done

  purge_by_name "$CON" || true
  echo "status: OK"
}

case "${1:-}" in
  start) shift; start_ap "$@";;
  stop)  shift; stop_ap "$@";;
  *) fail "usage: sudo $0 start --ssid <SSID> --pass <PASSWORD> [--iface wlan0] [--name myhotspot] [--debug] [--trace] | stop [--name myhotspot] [--debug] [--trace]";;
esac
