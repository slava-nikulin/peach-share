# build TODO - актуализировать версии
FROM node:24-alpine3.22 AS builder
WORKDIR /app
RUN corepack enable
COPY package.json ./
COPY pnpm-lock.yaml* yarn.lock* package-lock.json* ./
RUN if [ -f pnpm-lock.yaml ]; then pnpm i --frozen-lockfile; \
    elif [ -f yarn.lock ]; then npm i -g yarn && yarn install --frozen-lockfile; \
    else npm ci || npm i; fi
COPY . .
# важное: сборка в "emu" (офлайн к эмуляторам)
ENV VITE_OFFLINE=true VITE_USE_EMULATORS=true VITE_EMULATOR_RTD_HOST=localhost VITE_EMULATOR_RTD_PORT=9000
RUN if [ -f pnpm-lock.yaml ]; then pnpm build --mode emu || pnpm build; \
    elif [ -f yarn.lock ]; then yarn build --mode emu || yarn build; \
    else npm run build -- --mode emu || npm run build; fi

# runtime
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY local/docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80