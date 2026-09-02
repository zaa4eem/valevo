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
# npm workspaces hoist @prisma/client (and the schema-specific client that
# `prisma generate` writes next to it) to the repo-root node_modules, not
# apps/api/node_modules — copy from there.
COPY --from=build /repo/node_modules/.prisma node_modules/.prisma
# `prisma migrate deploy` and the ts-node-run seed script (prisma:seed) are
# invoked directly against this production image via `docker compose exec`
# — they need the TS source + a real tsconfig.json (ts-node's defaults
# without one are unreliable), not just the compiled `dist/` the server
# itself runs from.
COPY --from=build /repo/apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.json

WORKDIR /repo/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
