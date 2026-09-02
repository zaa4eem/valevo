# Implementation Plan: ZAA4EEM Platform (Site + Telegram Mini App)

**Branch**: `zaa4eem-site` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-zaa4eem-platform/spec.md`

## Summary

Build zaa4eem.ru: a personal site with a light social layer — subscriber
profiles, an owner-authored feed, a public Ideas board with voting that
feeds the owner's "add what's hype" curation loop, and a mini-games catalog
(launching with one game, Neon Snake) with per-game and global leaderboards.
The same Next.js app is opened inside Telegram as the Mini App (full
parity by construction, see research.md §1), with Telegram Login as the
primary auth path and email/password as a fallback. Deployed as additional
Docker containers on the existing VPS alongside the unrelated `Н12` bot,
under RF data-residency and content-moderation constraints.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS, end-to-end.

**Primary Dependencies**: Next.js 14 (App Router) for `apps/web`; NestJS 10
+ Prisma ORM for `apps/api`; grammy for `apps/bot`; Zod for shared
validation schemas (`packages/shared`); `crypto.scrypt` (Node built-in) +
`@nestjs/jwt` for auth; `@nestjs/throttler` for rate limiting.

**Storage**: PostgreSQL 16 (single database, one schema — see data-model.md).

**Testing**: Vitest for unit tests (all three apps); Supertest for
NestJS API integration tests; Playwright for a small smoke suite covering
the four user stories' happy paths.

**Target Platform**: Linux server (Docker containers) — the existing VPS
already running the `Н12` Telegram bot.

**Project Type**: Web application (frontend + backend) plus a small
companion Telegram bot process.

**Performance Goals**: Pages interactive in <2s on a typical mobile
connection; API p95 <300ms for read endpoints; Neon Snake runs at a steady
60fps on mid-range mobile browsers.

**Constraints**: Must coexist on a VPS shared with the `Н12` bot without
touching its code, container, or database (Constitution: hosting-only
sharing); all personal data stays on RF-based infrastructure (152-ФЗ); no
paid third-party services required to run the MVP.

**Scale/Scope**: Community scale at launch (hundreds of users, not
millions); 1 game, growing over time; single-region, single-instance
deployment — no need for horizontal scaling infrastructure yet.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — still passes.*

| Principle | Check |
|---|---|
| I. Community-Driven, Owner-Curated | Idea `status` transitions are owner-only actions (contracts/api.md `PATCH /ideas/:id/status`); votes only ever inform, never auto-change status. ✅ |
| II. RF Legal Compliance (NON-NEGOTIABLE) | Postgres on the RF VPS (research.md §4); moderation filter on all free-text fields (research.md §3, FR-010/027); 12+ content only, no monetization/gambling mechanics built (FR-028/029). ✅ |
| III. Telegram-Native, Website-Equal | Mini App = same Next.js app, not a parallel build (research.md §1) — parity holds structurally. ✅ |
| IV. One Codebase, One Language | TypeScript across `apps/web`, `apps/api`, `apps/bot`, `packages/shared`; no second backend language introduced. ✅ |
| V. Dark Neon Identity, Dashboard Structure | Design tokens defined once in `apps/web/src/styles/tokens.css` and reused by every screen incl. the Bankdash-inspired admin dashboard (see Project Structure). ✅ |
| VI. Simple MVP, Earn Complexity | 1 game, no multiplayer, no monetization module, filter-then-manual-review moderation (not a ML pipeline). ✅ |

No violations — Complexity Tracking table is empty/omitted.

## Project Structure

### Documentation (this feature)

```text
specs/001-zaa4eem-platform/
├── plan.md              # This file
├── research.md           # Phase 0 output
├── data-model.md          # Phase 1 output
├── quickstart.md          # Phase 1 output
├── contracts/
│   └── api.md             # Phase 1 output
└── tasks.md               # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root: `zaa4eem-site/`)

```text
zaa4eem-site/
├── apps/
│   ├── web/                      # Next.js — public site + Telegram Mini App UI + admin dashboard
│   │   ├── src/
│   │   │   ├── app/               # App Router: /, /feed, /ideas, /ideas/[id], /games, /games/[slug],
│   │   │   │                      # /u/[id], /login, /admin/*
│   │   │   ├── components/         # shared UI (Navbar, IdeaCard, Leaderboard, StatTile, Sidebar...)
│   │   │   ├── lib/                # api client, telegram-webapp helpers, auth context
│   │   │   └── styles/tokens.css   # design tokens (colors, type scale) — Principle V source of truth
│   │   └── Dockerfile
│   ├── api/                      # NestJS
│   │   ├── src/
│   │   │   ├── auth/               # telegram + email strategies, JWT, guards
│   │   │   ├── users/
│   │   │   ├── posts/
│   │   │   ├── ideas/
│   │   │   ├── games/
│   │   │   ├── admin/
│   │   │   └── moderation/         # shared filter service used by ideas + users
│   │   ├── prisma/schema.prisma
│   │   └── Dockerfile
│   └── bot/                      # grammy Telegram bot process
│       ├── src/index.ts           # sets menu button → Mini App URL, minimal commands
│       └── Dockerfile
├── packages/
│   └── shared/                   # Zod schemas + TS types imported by web, api, and bot
├── infra/
│   ├── docker-compose.yml         # postgres + api + web + bot, joined to shared reverse-proxy network
│   ├── nginx/zaa4eem.conf         # site block for zaa4eem.ru (TLS via existing/new Certbot setup)
│   └── .env.example
└── specs/001-zaa4eem-platform/    # this spec-kit feature
```

**Structure Decision**: npm-workspaces monorepo with three deployable apps
(`web`, `api`, `bot`) sharing one `packages/shared` package, matching
research.md §1 and §7. No `tests/` top-level split — each app owns its
tests colocated under its own `src/` (`*.spec.ts` next to source), which is
the idiomatic layout for both Next.js and NestJS and keeps the "simple MVP"
principle from fighting the frameworks' own conventions.

## Complexity Tracking

*No constitution violations — table intentionally omitted.*
