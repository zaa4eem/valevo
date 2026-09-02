# syntax=docker/dockerfile:1
# Build context is the monorepo root (zaa4eem-site/) — see infra/docker-compose.yml.

FROM node:20-slim AS build
WORKDIR /repo

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

COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
