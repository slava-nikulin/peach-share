#!/bin/bash
set -euo pipefail

PROJECT_NAME="peachshare-e2e"
COMPOSE_FILES="-f docker/docker-compose.base.yml -f docker/docker-compose.e2e.yml"
EXIT_CODE=0

# Обработчик для очистки при любом завершении
cleanup() {
    echo "🧹 Очищаем контейнеры..."
    docker compose -p "$PROJECT_NAME" $COMPOSE_FILES \
        --profile e2e \
        down --remove-orphans -v
    
    echo "🏁 Скрипт завершился с кодом: $EXIT_CODE"
}
trap cleanup EXIT INT TERM

# Запускаем тесты и сохраняем exit code
echo "🚀 Запускаем e2e тесты..."
docker compose -p "$PROJECT_NAME" $COMPOSE_FILES \
    --profile e2e \
    up --build --abort-on-container-exit --exit-code-from e2e-tests \
    || EXIT_CODE=$?

# Возвращаем exit code от тестов
exit $EXIT_CODE