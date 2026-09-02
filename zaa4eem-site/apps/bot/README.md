# @zaa4eem/bot

Small [grammy](https://grammy.dev)-based Telegram bot whose only job is to
be the entry point into the ZAA4EEM Mini App (research.md §1 — the Mini App
itself is just `apps/web` opened inside Telegram's WebView, not a separate
bot-side UI).

## Environment

- `TELEGRAM_BOT_TOKEN` — from [@BotFather](https://t.me/BotFather).
- `MINI_APP_URL` — the public HTTPS URL of `apps/web` (e.g. `https://zaa4eem.ru`
  in production). **Telegram requires this to be a real HTTPS URL** — plain
  `http://localhost:3000` will not work for the menu button or `webApp()`
  buttons. (Not the same as the API's `WEB_ORIGIN` — that one is a
  comma-separated CORS allowlist and can hold more than one origin.)

## Local development against a real Telegram client

Telegram Mini Apps must be served over HTTPS, so testing against a local
`next dev` server needs a tunnel:

```bash
# in a separate terminal, after `npm run dev:web`
npx ngrok http 3000
# copy the https://*.ngrok-free.app URL it prints
```

Then run the bot with that tunnel URL:

```bash
MINI_APP_URL=https://your-tunnel.ngrok-free.app TELEGRAM_BOT_TOKEN=... npm run dev --workspace apps/bot
```

Open the bot in Telegram and tap the menu button (or send `/start` and tap
the inline button) to launch the Mini App pointed at your local dev server.

## Production

In production, `MINI_APP_URL` is the real `https://zaa4eem.ru` domain — see
`zaa4eem-site/DEPLOY.md` for the full deployment flow.
