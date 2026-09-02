# Quickstart: ZAA4EEM Platform

## Prerequisites

- Node.js 20+, npm 10+
- Docker + Docker Compose (for Postgres, and for full-stack container runs)
- A Telegram bot token (from @BotFather) for `apps/bot` and Telegram auth in `apps/api`

## Local setup

```bash
cd zaa4eem-site
npm install
cp infra/.env.example infra/.env   # fill in DATABASE_URL, JWT secrets, TELEGRAM_BOT_TOKEN
docker compose -f infra/docker-compose.yml up -d postgres
npm run prisma:migrate --workspace apps/api
npm run prisma:seed --workspace apps/api   # creates the OWNER user + Neon Snake game row
npm run dev   # runs web (3000), api (3001), bot concurrently
```

## Validating each user story end-to-end

**P1 — Idea submission & voting**
1. Register a second (non-owner) test account.
2. Submit an idea from `/ideas/new`. Confirm it appears on `/ideas` with
   status `New` (or in the owner's moderation queue if it trips the filter).
3. Log in as a different user, upvote it — confirm the count increments and
   a second vote attempt is rejected.
4. Log in as the `OWNER` account, change its status from `/admin/ideas` —
   confirm the public board reflects the new status immediately.

**P2 — Mini-game & leaderboard**
1. Visit `/games/neon-snake` logged out — confirm it's playable without an
   account.
2. Log in, play again, beat your score — confirm `/games/neon-snake/leaderboard`
   shows your best score, and `/leaderboard` (global) reflects it too.

**P3 — Feed & profiles**
1. As `OWNER`, publish a post from `/admin/posts`.
2. As a logged-out visitor, confirm it appears at the top of `/`.
3. Visit any user's `/u/:id` profile — confirm stats (ideas submitted,
   games played) are correct.

**P4 — Telegram Mini App**
1. Set the bot's menu button URL to `https://<your-tunnel-or-domain>` (see
   `apps/bot/README.md` for local tunneling with a tool like `ngrok`).
2. Open the bot in Telegram, tap the menu button.
3. Confirm automatic sign-in (no login form shown) and that Ideas/Games/Feed
   all work identically to the browser version.

## Running everything in containers (staging-like)

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

Brings up `postgres`, `api`, `web`, and `bot` together, matching the
production compose file used in `specs/001-zaa4eem-platform/plan.md` →
Deployment.
