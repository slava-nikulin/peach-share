#!/bin/bash
set -euo pipefail

CERT_DIR="/certs"
CAROOT_DIR="$CERT_DIR/mkcert"
SERVER_CRT="$CERT_DIR/server.crt"
SERVER_KEY="$CERT_DIR/server.key"
TRAEFIK_DYNAMIC="$CERT_DIR/traefik-certs.yml"

HOST_IP="${HOST_LAN_IP:?HOST_LAN_IP not set}"
EXPIRY_GRACE_SEC=86400
FORCE_NEW_CA="${FORCE_NEW_CA:-false}"

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
  echo "$dump" | grep -q "DNS:localhost"      || return 1
  return 0
}

leaf_issuer_eq_ca_subject() {
  local ca_subj leaf_iss
  ca_subj="$(openssl x509 -in "$CAROOT_DIR/rootCA.pem" -noout -subject 2>/dev/null || true)"
  leaf_iss="$(openssl x509 -in "$SERVER_CRT" -noout -issuer 2>/dev/null || true)"
  [ "$leaf_iss" = "${ca_subj/subject=/issuer=}" ]
}

regen_ca() {
  echo "mkcert: FORCE_NEW_CA or CA invalid. Recreating CA"
  rm -rf "$CAROOT_DIR"/*
  CAROOT="$CAROOT_DIR" mkcert -install
}

regen_leaf() {
  echo "mkcert: Generating leaf for $HOST_IP, localhost, peach.local"
  CAROOT="$CAROOT_DIR" mkcert \
    -cert-file "$SERVER_CRT" \
    -key-file "$SERVER_KEY" \
    "$HOST_IP" localhost peach.local
}

# 1. ensure CA
if [ "$FORCE_NEW_CA" = "true" ] || ! ca_valid_enough; then
  regen_ca
fi

# 2. ensure leaf
if ! leaf_exists; then
  regen_leaf
else
  # mismatch between leaf issuer and CA? -> regen both CA+leaf полностью
  if ! leaf_issuer_eq_ca_subject; then
    echo "mkcert: leaf signed by different CA. Rotating CA+leaf"
    regen_ca
    regen_leaf
  else
    # leaf signed by our CA, но может быть просрочен или без нужного IP
    if ! leaf_not_expiring || ! leaf_has_ip; then
      regen_leaf
    fi
  fi
fi

# 3. публикуем корень для скачивания
if [ -d /certs-public ]; then
  cp "$CAROOT_DIR/rootCA.pem" /certs-public/peachshare-rootCA.crt
fi

# 4. traefik dynamic
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

# 5. traefik run
exec traefik \
  --entrypoints.websecure.address=:443 \
  --entrypoints.websecure_alt.address=:8443 \
  --providers.file.filename="$TRAEFIK_DYNAMIC" \
  --providers.file.watch=true \
  --providers.docker=true \
  --log.level=DEBUG
