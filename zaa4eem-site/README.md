# ZAA4EEM

Personal site + Telegram Mini App for zaa4eem: a feed, subscriber profiles,
a community Ideas board (subscribers propose, vote, and the owner ships
what's actually hype), and a mini-games catalog with leaderboards —
launching with **Neon Snake**.

Built spec-first with [spec-kit](https://github.com/github/spec-kit); the
full requirements interview, technical plan, and task breakdown live in
[`specs/001-zaa4eem-platform/`](specs/001-zaa4eem-platform/), and the
project's non-negotiables (RF legal compliance, one-codebase Telegram
parity, design system, etc.) are in
[`.specify/memory/constitution.md`](.specify/memory/constitution.md).

Build numbering (`MAJOR.FEATURES.BUILD`) and the current count are in
[`VERSIONING.md`](VERSIONING.md).

## Stack

TypeScript end-to-end: **Next.js** (`apps/web` — website + admin dashboard
+ the Telegram Mini App UI, since it's literally the same app), **NestJS +
Prisma/PostgreSQL** (`apps/api`), a small **grammy** Telegram bot
(`apps/bot`), and shared Zod schemas/types in `packages/shared`. See
[`specs/001-zaa4eem-platform/plan.md`](specs/001-zaa4eem-platform/plan.md)
for the full rationale.

## Getting started

See [`specs/001-zaa4eem-platform/quickstart.md`](specs/001-zaa4eem-platform/quickstart.md)
for local setup and how to validate each user story end-to-end.

```bash
npm install
cp infra/.env.example infra/.env   # fill in secrets
docker compose -f infra/docker-compose.yml up -d postgres
npm run prisma:migrate --workspace apps/api
npm run prisma:seed --workspace apps/api
npm run dev
```

- Web: http://localhost:3000
- API: http://localhost:3001/api

## Deploying

See [`DEPLOY.md`](DEPLOY.md) for the full VPS deployment flow (Docker
Compose, Nginx + TLS, DNS at reg.ru, Telegram bot wiring).

## Project layout

```text
apps/web     Next.js — public site, admin dashboard, Telegram Mini App UI
apps/api     NestJS — REST API, Prisma/PostgreSQL
apps/bot     grammy — Telegram bot (opens the Mini App)
packages/shared   Zod schemas/types shared by all three
infra/       Docker Compose, Nginx config, env template
specs/       spec-kit artifacts (spec, plan, tasks, research, data model)
```

## Testing

- `npm test` — unit + API integration tests (`packages/shared` via Vitest,
  `apps/api` via Jest; the `*.e2e-spec.ts` suites need a running Postgres —
  see quickstart.md).
- `npm run test --workspace apps/web` — Playwright smoke tests (needs the
  full stack running).
- `apps/web/e2e/telegram-miniapp.md` — manual checklist for the parts of
  User Story 4 that can't be scripted (a real Telegram client).
