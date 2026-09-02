# Deploying ZAA4EEM

Target: `zaa4eem-vmpico` (`222.167.211.74`) — the same VPS that already runs
the `Н12` Telegram bot stack, deployed as a separate, additive Docker
Compose project. Nothing here touches `Н12`'s code, containers, or database.

The VPS already runs a shared reverse proxy —
[`nginx-proxy`](https://github.com/nginx-proxy/nginx-proxy) +
[`nginx-proxy-acme`](https://github.com/nginx-proxy/acme-companion) on the
Docker network `proxy`, plus Portainer. **We don't run our own nginx or
certbot** — `web` and `api` just join the `proxy` network and set
`VIRTUAL_HOST`/`LETSENCRYPT_HOST` env vars; `nginx-proxy` auto-discovers
them and `acme-companion` auto-issues the TLS certificate. This is why the
API gets its own subdomain (`api.zaa4eem.ru`) instead of a `/api` path —
`nginx-proxy` routes by hostname, not by path.

## What's needed from you (checklist)

1. **DNS at reg.ru** — three `A` records pointed at `222.167.211.74`
   (step 1 below).
2. **Telegram bot token** — already have it (from @BotFather). Goes into
   `infra/.env` on the server only, never into git.
3. **Owner login** — Telegram numeric ID and/or email+password, for the
   seed script. Also goes into `infra/.env` only.
4. **A real email address** for Let's Encrypt renewal notices
   (`LETSENCRYPT_EMAIL` — any inbox works, doesn't need to be @zaa4eem.ru).
5. You run every command below yourself on the VPS.

## 1. Point the domain at the server

In the reg.ru DNS panel for `zaa4eem.ru`, add:

| Type | Host | Value |
|---|---|---|
| A | @ | `222.167.211.74` |
| A | www | `222.167.211.74` |
| A | api | `222.167.211.74` |

DNS propagation can take up to a few hours. Confirm all three resolve
before step 5 (cert issuance depends on it):

```bash
dig +short zaa4eem.ru
dig +short www.zaa4eem.ru
dig +short api.zaa4eem.ru
```

## 2. Get the code onto the server

```bash
git clone https://github.com/zaa4eem/valevo.git
cd valevo
git checkout zaa4eem-site
cd zaa4eem-site
```

## 3. Configure environment

```bash
cp infra/.env.example infra/.env
nano infra/.env
```

Fill in:

- `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — generate
  each with `openssl rand -hex 32`.
- `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (the `@...bot`
  username, without `@`).
- `LETSENCRYPT_EMAIL` — your real email.
- `NGINX_PROXY_NETWORK=proxy` (already the default in `.env.example` —
  confirmed via `docker inspect nginx-proxy` on this VPS).
- `WEB_VIRTUAL_HOST=zaa4eem.ru,www.zaa4eem.ru`,
  `API_VIRTUAL_HOST=api.zaa4eem.ru`, `MINI_APP_URL=https://zaa4eem.ru`,
  `WEB_ORIGIN=https://zaa4eem.ru,https://www.zaa4eem.ru`,
  `NEXT_PUBLIC_API_URL=https://api.zaa4eem.ru/api` — already correct in
  `.env.example`, just confirm you didn't change the domain.
- `OWNER_TELEGRAM_ID` and/or `OWNER_EMAIL` + `OWNER_PASSWORD` — whichever
  you want to log in with as the platform owner.

## 4. Build and start everything

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
```

First build takes a few minutes (Next.js + NestJS compile from source in
the Docker build stage). Watch it come up:

```bash
docker compose -f infra/docker-compose.yml ps
docker compose -f infra/docker-compose.yml logs -f
```

`nginx-proxy-acme` picks up the new `LETSENCRYPT_HOST` values within about
a minute and requests the certificates automatically — check its logs if
`https://zaa4eem.ru` doesn't have a valid cert after a few minutes:

```bash
docker logs nginx-proxy-acme --tail 50
```

## 5. Run migrations and seed the owner account

```bash
docker compose -f infra/docker-compose.yml exec api npm run prisma:migrate:deploy --workspace @zaa4eem/api
docker compose -f infra/docker-compose.yml exec api npm run prisma:seed --workspace @zaa4eem/api
```

## 6. Verify

- `https://zaa4eem.ru` loads the site with a valid padlock.
- `https://api.zaa4eem.ru/api/games` returns the seeded Neon Snake JSON.
- Open the bot in Telegram, tap the menu button — the Mini App should load
  and auto-sign you in as the owner.
- Run through `specs/001-zaa4eem-platform/quickstart.md`'s four validation
  scenarios (P1–P4), plus `apps/web/e2e/telegram-miniapp.md`'s manual
  Telegram checklist.

## Updating a running deployment

```bash
git pull
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
docker compose -f infra/docker-compose.yml exec api npm run prisma:migrate:deploy --workspace @zaa4eem/api
```

## Notes

- Nothing here reuses `Н12`'s database, containers, or ports — it's a fully
  separate Compose project on the same host and the same shared
  `nginx-proxy`/`proxy` network (Constitution: "hosting-only" sharing).
- `postgres`, `api`, `web`, `bot` all sit on this project's own default
  network too, for service-to-service traffic (e.g. `api` → `postgres`);
  only `api` and `web` additionally join `proxy` so `nginx-proxy` can reach
  them.
- If you ever need to point a different reverse-proxy setup at this stack
  instead, `api` listens on `3001` and `web` on `3000` inside their
  containers — swap the `VIRTUAL_HOST`-based routing for whatever your new
  proxy needs.
