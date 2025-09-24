# entrypoint.sh
set -e

# Обновляем зависимости из локального pnpm store (без сети)
pnpm install --frozen-lockfile --offline --prod

# Production билд
pnpm run build

# Запуск vite preview в проде, доступен по 0.0.0.0:4173
pnpm exec vite preview --host 0.0.0.0 --port 4173
