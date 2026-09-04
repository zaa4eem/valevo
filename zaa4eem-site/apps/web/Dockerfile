# syntax=docker/dockerfile:1
# Build context is the monorepo root (zaa4eem-site/) — see infra/docker-compose.yml.

FROM node:20-slim AS build
WORKDIR /repo

# NEXT_PUBLIC_* vars are inlined into the client JS bundle at build time —
# they must be passed as build ARGs (see infra/docker-compose.yml's
# `build.args`), not just set on the running container, or the browser
# bundle ships with them undefined (and every client-side fetch silently
# points at the fallback/nothing).
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=${NEXT_PUBLIC_TELEGRAM_BOT_USERNAME}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID}

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,target=/root/.npm npm ci

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build --workspace @zaa4eem/shared
# Next.js's own build cache (.next/cache) persists across builds via this
# mount, so repeat builds after a small source change are much faster than
# a cold compile.
RUN --mount=type=cache,target=/repo/apps/web/.next/cache \
    npm run build --workspace @zaa4eem/web

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Docker auto-sets HOSTNAME to the container's own short ID, and Next.js's
# standalone server.js binds to whatever HOSTNAME resolves to instead of
# all interfaces. With multiple Docker networks attached, that resolves via
# /etc/hosts to only ONE of them — so anything connecting from the other
# network (e.g. nginx-proxy) gets "connection refused" even though the
# server logs "Ready". Force binding to all interfaces explicitly.
ENV HOSTNAME=0.0.0.0

COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
