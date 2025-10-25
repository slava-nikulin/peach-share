## test


HOST_LAN_IP=$(ip route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}') docker compose -p peachshare-offline -f offline/docker-compose.offline.yml up