# Deploying ZAA4EEM

Target: the existing VPS that already runs the `Н12` Telegram bot (see
`../Н12/docker-compose.yml`), deployed as a separate, additive Docker
Compose stack — nothing here touches `Н12`'s code, container, or database.

## What I need from you before this can go live

I (Claude) don't have SSH access to your VPS, access to your reg.ru DNS
panel, or your Telegram bot token — you'll need to either run the commands
below yourself, or share the specific access needed (VPS SSH, or just have
me guide you) so this can be completed. Specifically:

1. **VPS access** — SSH to the server that runs `Н12`, or you run the
   commands below yourself.
2. **DNS at reg.ru** — an `A` record for `zaa4eem.ru` (and `www.zaa4eem.ru`)
   pointed at the VPS's public IP.
3. **Telegram bot token** — from [@BotFather](https://t.me/BotFather), for
   `TELEGRAM_BOT_TOKEN` in `infra/.env`. You said you'll fill this in
   yourself.
4. **Decide the owner login**: a Telegram numeric user ID (send `/start` to
   [@userinfobot](https://t.me/userinfobot) to get yours) and/or an email +
   password, for `OWNER_TELEGRAM_ID` / `OWNER_EMAIL` / `OWNER_PASSWORD` in
   `infra/.env` — this is what the seed script (`apps/api/prisma/seed.ts`)
   uses to create your `OWNER` account.

## 1. Point the domain at the server

In the reg.ru DNS panel for `zaa4eem.ru`, add:

| Type | Host | Value |
|---|---|---|
| A | @ | `<VPS public IP>` |
| A | www | `<VPS public IP>` |

DNS propagation can take up to a few hours; confirm with `dig zaa4eem.ru`
before requesting a TLS certificate (step 4) or it will fail.

## 2. Get the code onto the server

```bash
# on the VPS
git clone https://github.com/zaa4eem/valevo.git
cd valevo
git checkout zaa4eem-site
cd zaa4eem-site
```

## 3. Configure environment

```bash
cp infra/.env.example infra/.env
# edit infra/.env — fill in real secrets:
#   - POSTGRES_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
#     (generate each with: openssl rand -hex 32)
#   - TELEGRAM_BOT_TOKEN, NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
#   - OWNER_TELEGRAM_ID and/or OWNER_EMAIL + OWNER_PASSWORD
nano infra/.env
```

## 4. First-time TLS certificate (chicken-and-egg with Nginx)

Nginx's HTTPS server block references a certificate that doesn't exist yet.
Bootstrap it once:

```bash
# a) temporarily comment out the `server { listen 443 ... }` block
#    in infra/nginx/zaa4eem.conf, keeping only the HTTP block
# b) bring up nginx (HTTP only) so certbot's ACME challenge is servable
docker compose -f infra/docker-compose.yml up -d nginx

# c) request the certificate
docker compose -f infra/docker-compose.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d zaa4eem.ru -d www.zaa4eem.ru \
  --email <your-email> --agree-tos --no-eff-email

# d) uncomment the HTTPS server block again, then reload
docker compose -f infra/docker-compose.yml restart nginx
```

The `certbot` service in `docker-compose.yml` keeps renewing automatically
after this (checks twice a day, renews when due).

## 5. Build and start everything

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

## 6. Run migrations and seed the owner account

```bash
docker compose -f infra/docker-compose.yml exec api npm run prisma:migrate:deploy --workspace @zaa4eem/api
docker compose -f infra/docker-compose.yml exec api npm run prisma:seed --workspace @zaa4eem/api
```

## 7. Point the Telegram bot's menu button at the live domain

Already handled automatically — `apps/bot` sets the menu button to
`WEB_ORIGIN` from `infra/.env` on startup. Confirm it worked: open the bot
in Telegram, tap the menu button, and it should open `https://zaa4eem.ru`
inside the Mini App.

## 8. Verify

Run through `specs/001-zaa4eem-platform/quickstart.md`'s four validation
scenarios (P1–P4) against the live domain, plus
`apps/web/e2e/telegram-miniapp.md`'s manual Telegram checklist.

## Updating a running deployment

```bash
git pull
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml exec api npm run prisma:migrate:deploy --workspace @zaa4eem/api
```

## Notes

- Nothing here reuses `Н12`'s database, containers, or ports — it's a fully
  separate stack on the same host (Constitution: "hosting-only" sharing).
- If port 80/443 is already bound by something else on this VPS, adjust the
  `nginx` service's `ports:` in `infra/docker-compose.yml` accordingly, or
  point your existing reverse proxy at `web:3000` / `api:3001` instead of
  running the bundled `nginx`/`certbot` services at all.
