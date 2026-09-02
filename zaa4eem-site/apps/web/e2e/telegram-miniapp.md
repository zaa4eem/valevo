# Manual verification: Telegram Mini App (US4)

Playwright cannot script a real Telegram client/WebView, so User Story 4's
"full platform inside Telegram" acceptance criteria (spec.md) are verified
manually. Run this checklist after any change touching `apps/web/src/lib/
telegram.ts`, `auth-context.tsx`, `AppChrome.tsx`, or `apps/bot`.

## Prerequisites

- `apps/bot` running with `MINI_APP_URL` pointed at an HTTPS URL (a tunnel in
  dev, the real domain in staging/prod) — see `apps/bot/README.md`.
- `apps/api` and `apps/web` running and reachable at that same origin.

## Steps

1. Open the bot in Telegram, tap the menu button (or `/start` → the inline
   button).
2. **Auto sign-in**: the Mini App should load directly into the signed-in
   state — no login form shown. ✅ / ❌
3. **Chrome adapts**: the normal website `Navbar` should be hidden; Telegram's
   own back button/theme should be in control instead. ✅ / ❌
4. **Feed (US3)**: the home feed loads and shows the owner's latest posts. ✅ / ❌
5. **Ideas (US1)**: open Ideas, submit one, and upvote another — both should
   work identically to the browser version. ✅ / ❌
6. **Games (US2)**: open Neon Snake, play a round with touch controls, and
   confirm the score is submitted (check `/leaderboard` afterward). ✅ / ❌
7. **Profile**: open your own profile via the avatar/name — stats should
   match what you just did (1 idea submitted, 1 game played, etc). ✅ / ❌
8. **Same account, different surface**: open `https://<domain>` in a normal
   mobile browser and log in via the Telegram Login Widget with the same
   Telegram account — confirm it's the *same* profile/ideas/votes/scores,
   not a duplicate account (FR-003).  ✅ / ❌

Record the date and which build/commit this was run against when reporting
results (e.g. in the PR description or a comment on the deploy task).
