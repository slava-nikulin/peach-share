#!/usr/bin/env sh
set -euo pipefail

PORT="${PORT:-5173}"
HOST_LAN_IP="${HOST_LAN_IP:-0.0.0.0}"
MODE="${MODE:-emu}"
ROOT_DIR="${ROOT_DIR:-/usr/share/nginx/html}"

HTTP_HOST_PORT="${HTTP_HOST_PORT:-8080}"
HTTPS_HOST_PORT="${HTTPS_HOST_PORT:-8443}"

if [ -z "${PORT}" ] || ! printf '%s' "${PORT}" | grep -Eq '^[0-9]+$'; then
  echo "Invalid PORT value: ${PORT}" >&2
  exit 1
fi

echo "Static bundle mode: ${MODE}"
echo "Static server root: ${ROOT_DIR}"

echo
echo "Container listen: 0.0.0.0:${PORT}"
echo "Host HTTP port:  ${HTTP_HOST_PORT}"
echo "Host HTTPS port: ${HTTPS_HOST_PORT}"

echo
echo "HTTP (no TLS, direct from web container):"
echo "  LAN   http://${HOST_LAN_IP}:${HTTP_HOST_PORT}"
echo "  Local http://localhost:${HTTP_HOST_PORT}"

echo
echo "HTTPS (TLS via Traefik reverse proxy):"
echo "  LAN   https://${HOST_LAN_IP}:${HTTPS_HOST_PORT}"
echo "  Local https://localhost:${HTTPS_HOST_PORT}"

if [ ! -d "${ROOT_DIR}" ]; then
  echo "Warning: ROOT_DIR ${ROOT_DIR} does not exist" >&2
fi

NGINX_CONF="/etc/nginx/conf.d/default.conf"
cat <<EOF > "${NGINX_CONF}"
server {
    listen ${PORT};
    listen [::]:${PORT};
    server_name _;
    root ${ROOT_DIR};
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location ~* \.(?:js|css|png|jpg|jpeg|gif|ico|svg|webp|json|txt|woff|woff2|ttf|otf|mp4|webm|mp3|wasm)$ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files \$uri =404;
    }
}
EOF

exec nginx -g 'daemon off;'
