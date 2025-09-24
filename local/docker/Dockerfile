# Dockerfile.app
FROM node:22.20.0-alpine AS base

WORKDIR /app

# Включаем corepack и фиксируем pnpm в образе
RUN corepack enable && corepack prepare pnpm@10.17.0 --activate

# Предзагрузка зависимостей в pnpm store по lockfile для кэширования и офлайна
COPY pnpm-lock.yaml ./
RUN pnpm fetch

# Теперь копируем манифест и устанавливаем (создаём node_modules из store)
COPY package.json ./
# Можно добавить .npmrc / pnpm-workspace.yaml при необходимости
RUN pnpm install --frozen-lockfile --offline --prod

# Копируем остальной код в рантайм-слой на следующем этапе
FROM node:22.20.0-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.17.0 --activate

# Переносим pnpm store и готовые node_modules в runtime-слой
COPY --from=base /root/.local/share/pnpm/store /root/.local/share/pnpm/store
COPY --from=base /app/node_modules /app/node_modules

# Код будет монтироваться томом, но на всякий случай копируем текущую директорию,
# чтобы контейнер мог стартовать и без монтирования.
COPY . .

# Скрипт запуска в production-режиме
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 4173
