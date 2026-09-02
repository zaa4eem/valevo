# Phase 0 Research: ZAA4EEM Platform

All items below were either fixed by the requirements interview (see
`spec.md` → Clarifications) or are architecture decisions needed to turn
those answers into a buildable system. No `NEEDS CLARIFICATION` markers
remain.

## 1. Telegram Mini App architecture

**Decision**: The Telegram Mini App is **not** a separate codebase — it is
the same Next.js web app (`apps/web`), opened inside Telegram's WebView via
the bot's menu button, pointed at `https://zaa4eem.ru`. The app detects a
Telegram runtime at load time (`window.Telegram.WebApp` present) and:
- Adapts chrome: hides the normal site header, uses Telegram's native back
  button (`BackButton` API) and theme colors (`themeParams`) instead of a
  duplicated nav.
- Auto-authenticates using Telegram's `initData` payload instead of showing
  a login form.

**Rationale**: This is the only way to satisfy Constitution Principle III
("Telegram Mini App = full mirror") **by construction** rather than by
discipline — there is no second UI to keep in sync, so parity (spec SC-003)
can't drift. It also satisfies Principle IV (one codebase) directly.

**Alternatives considered**: A dedicated Telegram-only React bundle sharing
only API calls with the website — rejected: doubles UI maintenance for a
one-person project and makes "100% feature parity" an ongoing promise
instead of a structural guarantee.

## 2. Authentication

**Decision**: Two credential paths issuing the same session:
- **Telegram**: bot sends the Mini App URL; client reads `Telegram.WebApp.initData`;
  API verifies it server-side per Telegram's documented algorithm (HMAC-SHA256
  of the sorted data-check-string, keyed by `SHA256(bot_token)`), checks the
  `auth_date` freshness window, then creates/looks up the User by
  `telegramId`.
- **Email/password**: standard NestJS + Passport local strategy; password
  hashed with Node's built-in **`crypto.scrypt`** (salted, RFC-7914 KDF) —
  chosen over argon2/bcrypt specifically to avoid a native-compiled
  dependency in the Docker build/deploy pipeline, with no loss of security
  posture at this scale.
- Both paths issue the same short-lived **JWT access token** (in an
  `httpOnly`, `Secure`, `SameSite=Lax` cookie for the web, and in-memory for
  the Telegram WebView context where cookies can be unreliable — falls back
  to `Authorization: Bearer` header stored in `sessionStorage`) plus a
  rotating **refresh token** hashed and stored in the `RefreshToken` table so
  sessions can be revoked (e.g. on ban).
- Linking: if a logged-in email/password user later verifies a Telegram
  identity (or vice versa) with a matching account, the identities are
  merged onto one `User` row rather than creating a duplicate (FR-003).

**Rationale**: argon2 + JWT + rotating refresh tokens is the standard,
low-complexity NestJS pattern; verifying `initData` server-side is Telegram's
documented, required approach — client claims are never trusted directly
(Constitution "Security & Data Requirements").

## 3. Content moderation filter

**Decision**: A lightweight, self-hosted word/pattern filter
(`packages/shared/moderation`) checks idea titles/descriptions and profile
bios against a curated RU+EN banned-word list (profanity + a short list of
terms tied to illegal content categories) before publish. A match doesn't
silently reject — it flips the item's `moderationState` to `pending_review`
so it queues for the owner (per spec Edge Cases: "held, not discarded").
Anything that doesn't match publishes immediately as `clean`.

**Rationale**: Matches FR-010/FR-027 without depending on a paid third-party
moderation API (keeps the single-VPS MVP self-contained per Principle VI);
owner remains the final authority per Principle I.

**Alternatives considered**: Third-party moderation API (e.g. a cloud content
-safety service) — rejected for MVP: external dependency, cost, and latency
not justified until abuse is actually observed.

## 4. Data residency (152-ФЗ)

**Decision**: PostgreSQL runs as a container on the same RF-based VPS that
already hosts the `Н12` bot; no user PII leaves that host (no third-party
SaaS auth/analytics providers that store personal data outside RF are used
in MVP). Backups are stored on the same host/RF-based backup target.

**Rationale**: Directly satisfies FR-026/SC-006 without introducing new
infrastructure providers.

## 5. Mini-game choice and scoring

**Decision**: Launch game is **Neon Snake** — classic snake mechanics
rendered on an HTML5 `<canvas>` in the site's neon-green-on-black palette.
Score = food eaten. Chosen because it thematically fits the brand (a green
line on black *is* the logo's visual language), needs no external art
assets, is fast to build well, and is trivially replayable — good fit for a
single-game MVP leaderboard.

**Score plausibility ceiling** (FR-018): a per-game constant
(`maxPlausibleScore`) in the `Game` row; any submitted score above it is
stored with `reviewState = held_for_review` instead of auto-publishing to
the leaderboard.

**Alternatives considered**: embedding a third-party open-source web game —
rejected, conflicts with "own games, ideas-only from users" decision and
adds licensing/attribution overhead for no real benefit at MVP scale.

## 6. Rate limiting & abuse prevention

**Decision**: `@nestjs/throttler` at the API gateway level for all
write endpoints (idea submission, voting, score submission, registration);
per-user limits (not just per-IP) once authenticated, since Telegram users
behind shared infra can share IPs.

## 7. Monorepo & deployment shape

**Decision**: npm workspaces (no extra tooling) with three deployable apps
— `apps/web` (Next.js), `apps/api` (NestJS), `apps/bot` (small grammy-based
Telegram bot process) — plus `packages/shared` for Zod schemas/types used by
all three. Each app gets its own Dockerfile; `infra/docker-compose.yml`
composes `web`, `api`, `bot`, `postgres`, joined to the same reverse-proxy
network `Н12`'s bot already runs behind (or a new Nginx site block if none
exists), fronted by Nginx + Certbot for `zaa4eem.ru` TLS.

**Rationale**: keeps deployment additive to the existing VPS (Constitution:
"nothing may depend on or modify Н12; they may share hosting only") without
requiring a new orchestration platform.
