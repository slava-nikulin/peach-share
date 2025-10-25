#!/usr/bin/env sh
set -euo pipefail

PORT="${PORT:-5173}"
HOST_LAN_IP="${HOST_LAN_IP:-0.0.0.0}"
MODE="${MODE:-emu}"
ROOT_DIR="${ROOT_DIR:-/usr/share/nginx/html}"

if [ -z "${PORT}" ] || ! printf '%s' "${PORT}" | grep -Eq '^[0-9]+$'; then
  echo "Invalid PORT value: ${PORT}" >&2
  exit 1
fi

echo "HTTP server will listen on 0.0.0.0:${PORT}"
echo "LAN URL:  http://${HOST_LAN_IP}:${PORT}"
echo "Local URL: http://localhost:${PORT}"

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
