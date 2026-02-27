#!/bin/bash
set -euo pipefail

CERT_DIR="/certs"
CAROOT_DIR="$CERT_DIR/mkcert"
SERVER_CRT="$CERT_DIR/server.crt"
SERVER_KEY="$CERT_DIR/server.key"
TRAEFIK_DYNAMIC="$CERT_DIR/traefik-certs.yml"

HOST_IP="${HOST_LAN_IP:?HOST_LAN_IP not set}"
LEAF_ROTATE_DAYS_BEFORE_EXPIRY="${LEAF_ROTATE_DAYS_BEFORE_EXPIRY:-1}"
EXPIRY_GRACE_SEC="$(( LEAF_ROTATE_DAYS_BEFORE_EXPIRY * 24 * 3600 ))"
FORCE_NEW_CA="${FORCE_NEW_CA:-false}"

HTTPS_ALT_PORT="${HTTPS_HOST_PORT:-8443}"
RTDB_PORT="${RTDB_HOST_PORT:-9443}"
AUTH_PORT="${AUTH_HOST_PORT:-9444}"

mkdir -p "$CERT_DIR" "$CAROOT_DIR"

has_ca() {
  [ -f "$CAROOT_DIR/rootCA.pem" ] && [ -f "$CAROOT_DIR/rootCA-key.pem" ]
}

ca_valid_enough() {
  has_ca && openssl x509 -checkend "$EXPIRY_GRACE_SEC" -noout -in "$CAROOT_DIR/rootCA.pem" >/dev/null 2>&1
}

leaf_exists() {
  [ -f "$SERVER_CRT" ] && [ -f "$SERVER_KEY" ]
}

leaf_not_expiring() {
  openssl x509 -checkend "$EXPIRY_GRACE_SEC" -noout -in "$SERVER_CRT" >/dev/null 2>&1
}

leaf_has_ip_and_localhost() {
  local dump
  dump="$(openssl x509 -in "$SERVER_CRT" -noout -text | sed -n '/Subject Alternative Name/,$p')"
  echo "$dump" | grep -q "IP Address:$HOST_IP" || return 1
  echo "$dump" | grep -q "DNS:localhost"       || return 1
  return 0
}

leaf_issuer_eq_ca_subject() {
  local ca_subj leaf_iss
  ca_subj="$(openssl x509 -in "$CAROOT_DIR/rootCA.pem" -noout -subject 2>/dev/null || true)"
  leaf_iss="$(openssl x509 -in "$SERVER_CRT" -noout -issuer 2>/dev/null || true)"
  [ "$leaf_iss" = "${ca_subj/subject=/issuer=}" ]
}

regen_ca() {
  echo "mkcert: creating CA in $CAROOT_DIR"
  rm -rf "$CAROOT_DIR"/*
  # В контейнере установка в системные trust stores не обязательна.
  CAROOT="$CAROOT_DIR" mkcert -install || true
  # На случай если -install не создал CA (редко), “дергаем” генерацию сертификата,
  # mkcert создаст CA автоматически при необходимости.
  has_ca || true
}

regen_leaf() {
  echo "mkcert: generating leaf for proxy.peach.local, peach.local, localhost, $HOST_IP"
  CAROOT="$CAROOT_DIR" mkcert \
    -cert-file "$SERVER_CRT" \
    -key-file "$SERVER_KEY" \
    proxy.peach.local peach.local localhost "$HOST_IP"
}

# 1) ensure CA
if [ "$FORCE_NEW_CA" = "true" ] || ! ca_valid_enough; then
  regen_ca
fi

# 2) ensure leaf
if ! leaf_exists; then
  regen_leaf
else
  if ! leaf_issuer_eq_ca_subject; then
    echo "mkcert: leaf signed by different CA. Rotating CA+leaf"
    regen_ca
    regen_leaf
  else
    if ! leaf_not_expiring || ! leaf_has_ip_and_localhost; then
      regen_leaf
    fi
  fi
fi

# 3) publish CA for clients to download
if [ -d /certs-public ]; then
  cp -f "$CAROOT_DIR/rootCA.pem" /certs-public/peachshare-rootCA.crt
fi

# 4) traefik dynamic tls config
cat > "$TRAEFIK_DYNAMIC" <<EOF
tls:
  certificates:
    - certFile: /certs/server.crt
      keyFile: /certs/server.key
  stores:
    default:
      defaultCertificate:
        certFile: /certs/server.crt
        keyFile: /certs/server.key
EOF

echo "Traefik offline proxy is ready."
echo "  App HTTPS : https://${HOST_IP} (alt: https://${HOST_IP}:${HTTPS_ALT_PORT})"
echo "  RTDB TLS  : https://${HOST_IP}:${RTDB_PORT}"
echo "  Auth TLS  : https://${HOST_IP}:${AUTH_PORT}"
echo "  CA download: https://${HOST_IP}/ca/peachshare-rootCA.crt"

exec traefik \
  --entrypoints.websecure.address=":443" \
  --entrypoints.websecure_alt.address=":${HTTPS_ALT_PORT}" \
  --entrypoints.rtdb.address=":${RTDB_PORT}" \
  --entrypoints.auth.address=":${AUTH_PORT}" \
  --entrypoints.websecure.transport.respondingTimeouts.idleTimeout=0 \
  --entrypoints.websecure_alt.transport.respondingTimeouts.idleTimeout=0 \
  --entrypoints.rtdb.transport.respondingTimeouts.idleTimeout=0 \
  --entrypoints.auth.transport.respondingTimeouts.idleTimeout=0 \
  --providers.file.filename="$TRAEFIK_DYNAMIC" \
  --providers.file.watch=true \
  --providers.docker=true \
  --providers.docker.exposedbydefault=false