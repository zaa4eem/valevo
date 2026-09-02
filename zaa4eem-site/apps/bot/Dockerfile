# syntax=docker/dockerfile:1
# Build context is the monorepo root (zaa4eem-site/) — see infra/docker-compose.yml.

FROM node:20-slim AS build
WORKDIR /repo

COPY package.json package-lock.json* ./
COPY apps/bot/package.json apps/bot/package.json
RUN --mount=type=cache,target=/root/.npm npm ci

COPY apps/bot apps/bot
RUN npm run build --workspace @zaa4eem/bot

FROM node:20-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY apps/bot/package.json apps/bot/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY --from=build /repo/apps/bot/dist apps/bot/dist

WORKDIR /repo/apps/bot
CMD ["node", "dist/index.js"]
