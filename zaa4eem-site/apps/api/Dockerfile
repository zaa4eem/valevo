# Build context is the monorepo root (zaa4eem-site/), not this directory —
# see infra/docker-compose.yml. Needed because npm workspaces require the
# root package.json + lockfile to resolve @zaa4eem/shared.

FROM node:20-slim AS build
WORKDIR /repo

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @zaa4eem/shared
RUN npm run prisma:generate --workspace @zaa4eem/api
RUN npm run build --workspace @zaa4eem/api

FROM node:20-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev

COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma
COPY --from=build /repo/apps/api/node_modules/.prisma apps/api/node_modules/.prisma

WORKDIR /repo/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
