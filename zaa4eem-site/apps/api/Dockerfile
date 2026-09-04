# syntax=docker/dockerfile:1
# Build context is the monorepo root (zaa4eem-site/), not this directory —
# see infra/docker-compose.yml. Needed because npm workspaces require the
# root package.json + lockfile to resolve @zaa4eem/shared.

FROM node:20-slim AS build
WORKDIR /repo

# node:20-slim (Debian) ships without libssl by default; Prisma's engine
# needs it both to detect the right binary target at `prisma generate`
# time (build stage) and to actually load the engine at runtime.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,target=/root/.npm npm ci

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @zaa4eem/shared
RUN npm run prisma:generate --workspace @zaa4eem/api
RUN npm run build --workspace @zaa4eem/api

FROM node:20-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production


# gifsicle: crops/resizes uploaded animated GIF avatars frame-by-frame
# (preserving animation) — a <canvas> draw would only capture one frame.
# gosu: drops from root to the unprivileged `node` user in the entrypoint,
# after that entrypoint fixes up ownership of the (possibly volume-mounted,
# possibly root-owned from a prior deploy) uploads directory — see
# docker-entrypoint.sh. Avoids running the actual Node process as root.
RUN apt-get update -y && apt-get install -y openssl gifsicle gosu && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

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
RUN mkdir -p apps/api/uploads/avatars apps/api/uploads/post-images

COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /repo/apps/api
EXPOSE 3001
# No curl/wget in node:20-slim — use Node's own http client instead of
# adding an apt package just for this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health',res=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"
# The entrypoint starts as root (needed to chown the uploads volume), then
# execs the actual server as the unprivileged `node` user — the process
# that ever touches request data never runs as root.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
