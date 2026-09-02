---

description: "Task list for ZAA4EEM Platform implementation"
---

# Tasks: ZAA4EEM Platform (Site + Telegram Mini App)

**Input**: Design documents from `specs/001-zaa4eem-platform/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: A light test layer is included (unit tests for the moderation
filter and auth token logic, API integration tests for the write endpoints
most likely to regress, one Playwright smoke test per user story) — not
exhaustive coverage, consistent with Constitution Principle VI (simple MVP).

**Organization**: Tasks are grouped by user story from spec.md so each story
is independently implementable, testable, and demoable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an
  incomplete task)
- **[Story]**: US1 (Ideas+voting), US2 (Games+leaderboard), US3
  (Feed+profiles), US4 (Telegram Mini App) — matches spec.md priorities

## Path Conventions

Monorepo per plan.md: `apps/web`, `apps/api`, `apps/bot`, `packages/shared`,
`infra/` — all paths below are relative to `zaa4eem-site/`.

---

## Phase 1: Setup

- [ ] T001 Initialize npm workspaces monorepo: root `package.json` with
      `workspaces: ["apps/*", "packages/*"]`, `.gitignore`, `.nvmrc` (Node 20)
- [ ] T002 [P] Scaffold `packages/shared` (package.json, tsconfig.json,
      `src/index.ts`) for Zod schemas/types shared by web/api/bot
- [ ] T003 [P] Scaffold `apps/api` NestJS project (`nest new`-equivalent
      structure: `src/main.ts`, `src/app.module.ts`, `tsconfig.json`,
      `package.json` with `@nestjs/core`, `@nestjs/config`, `prisma`)
- [ ] T004 [P] Scaffold `apps/web` Next.js 14 App Router project
      (`package.json`, `tsconfig.json`, `next.config.js`, `src/app/layout.tsx`)
- [ ] T005 [P] Scaffold `apps/bot` grammy project (`package.json`,
      `tsconfig.json`, `src/index.ts` placeholder)
- [ ] T006 [P] Configure root ESLint + Prettier shared config used by all
      four packages
- [ ] T007 Add `infra/.env.example` listing every required env var
      (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
      `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_API_URL`, `WEB_ORIGIN`)
- [ ] T008 [P] Add `apps/web/src/styles/tokens.css` design tokens (colors:
      `--bg`, `--surface`, `--accent-green` #4ADE80-family, `--text`,
      radii, type scale) per Constitution Principle V, derived from the
      ZAA4EEM logo/banner reference

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story phase may begin until this phase is complete.

- [ ] T009 Define `apps/api/prisma/schema.prisma` with all entities from
      data-model.md (User, RefreshToken, Post, Idea, Vote, Game, Score,
      ModerationLogEntry) and enums
- [ ] T010 Run initial Prisma migration and generate client; add
      `npm run prisma:migrate` / `prisma:generate` scripts in `apps/api`
- [ ] T011 [P] Implement `packages/shared/src/schemas/*.ts` Zod schemas for
      every request/response body in contracts/api.md
- [ ] T012 [P] Implement moderation filter service
      `apps/api/src/moderation/moderation.service.ts` (curated RU+EN banned
      word/pattern list + `classify(text): 'clean' | 'pending_review'`) with
      unit tests in `moderation.service.spec.ts`
- [ ] T013 Implement JWT issuing/verification utilities
      `apps/api/src/auth/token.service.ts` (access + refresh, argon2 hashing
      helpers) with unit tests in `token.service.spec.ts`
- [ ] T014 Implement Telegram `initData` verification utility
      `apps/api/src/auth/telegram-verify.ts` (HMAC-SHA256 per research.md §2)
      with unit tests using a known-good fixture payload
- [ ] T015 Implement `AuthModule` skeleton in `apps/api/src/auth/` wiring
      Passport local strategy + JWT guard + `RolesGuard` (Owner vs Auth)
- [ ] T016 [P] Implement global exception filter + response shape
      (`apps/api/src/common/http-exception.filter.ts`) matching
      contracts/api.md error shape
- [ ] T017 [P] Wire `@nestjs/throttler` globally in `apps/api/src/app.module.ts`
      per research.md §6
- [ ] T018 [P] Implement `apps/web/src/lib/api-client.ts` typed fetch wrapper
      (base URL from env, attaches bearer/cookie, parses shared Zod schemas)
- [ ] T019 [P] Implement `apps/web/src/lib/telegram.ts` — detects
      `window.Telegram.WebApp`, exposes `isTelegram`, `initData`, theme sync,
      `BackButton` helpers
- [ ] T020 Implement `apps/web/src/lib/auth-context.tsx` (React context:
      current user, login/logout, calls `/auth/*` endpoints)
- [ ] T021 [P] Build shared UI shell components: `apps/web/src/components/
      Navbar.tsx`, `Sidebar.tsx`, `StatTile.tsx`, `Card.tsx` using tokens
      from T008 (Bankdash-style card/sidebar structure)
- [ ] T022 Seed script `apps/api/prisma/seed.ts` creating the `OWNER` user
      and the `neon-snake` `Game` row (slug, title, `maxPlausibleScore`)

**Checkpoint**: Foundation ready — user story phases can now proceed, in
priority order or in parallel by different contributors.

---

## Phase 3: User Story 1 - Submit an idea and watch it get picked up (P1) 🎯 MVP

**Goal**: Public Ideas board with submission, one-vote-per-user upvoting,
and owner-controlled status lifecycle — the platform's core differentiator.

**Independent Test**: Submit an idea as user A, upvote as user B, change its
status as the owner from the admin panel — all visible on `/ideas` without
Games or Feed existing yet.

- [ ] T023 [P] [US1] `IdeasService` in `apps/api/src/ideas/ideas.service.ts`:
      create (runs moderation filter from T012), list (sort=top|new,
      filtered by moderationState for non-owners), get-by-id
- [ ] T024 [P] [US1] `VotesService` in `apps/api/src/ideas/votes.service.ts`:
      add/remove vote with unique-constraint-backed idempotency, updates
      denormalized `voteCount` transactionally
- [ ] T025 [US1] `IdeasController` in `apps/api/src/ideas/ideas.controller.ts`
      implementing every `/ideas*` route from contracts/api.md, rate-limited
      on `POST /ideas`
- [ ] T026 [US1] `AdminIdeasController` in
      `apps/api/src/admin/admin-ideas.controller.ts`: `PATCH /ideas/:id/status`
      and `PATCH /ideas/:id/moderation`, Owner-guarded, writes a
      `ModerationLogEntry` on every moderation-state change
- [ ] T027 [P] [US1] API integration tests `apps/api/src/ideas/ideas.e2e-spec.ts`
      covering: submit → appears; double-vote rejected (409); non-owner
      cannot change status (403)
- [ ] T028 [P] [US1] `apps/web/src/app/ideas/page.tsx` — public board: list,
      sort toggle, vote button (optimistic), status badge per idea
- [ ] T029 [P] [US1] `apps/web/src/app/ideas/new/page.tsx` — submission form
      (title/description, client-side Zod validation from shared schemas)
- [ ] T030 [P] [US1] `apps/web/src/app/ideas/[id]/page.tsx` — idea detail
      view with current vote state
- [ ] T031 [US1] `apps/web/src/app/admin/ideas/page.tsx` — owner queue:
      pending-moderation items + status-change controls per idea
- [ ] T032 [P] [US1] Playwright smoke test `apps/web/e2e/ideas.spec.ts`
      exercising the Independent Test scenario above

**Checkpoint**: US1 fully functional and demoable standalone.

---

## Phase 4: User Story 2 - Play the launch mini-game and climb the leaderboard (P2)

**Goal**: Guest-playable Neon Snake with logged-in score submission and
per-game + global leaderboards.

**Independent Test**: Open `/games/neon-snake` logged out, play; log in,
beat your score, confirm it on the leaderboard.

- [ ] T033 [P] [US2] `GamesService`/`ScoresService` in
      `apps/api/src/games/`: list active games, get-by-slug, submit score
      (applies `maxPlausibleScore` ceiling → `reviewState`), leaderboard
      queries (per-game `MAX(value)` and global aggregate) per data-model.md
- [ ] T034 [US2] `GamesController` in `apps/api/src/games/games.controller.ts`
      implementing every `/games*` and `/leaderboard/global` route, score
      submission rate-limited and Auth-guarded
- [ ] T035 [P] [US2] API integration tests `apps/api/src/games/games.e2e-spec.ts`:
      score above ceiling held for review; leaderboard excludes held scores
- [ ] T036 [US2] Build Neon Snake game engine
      `apps/web/src/components/games/neon-snake/engine.ts` (canvas render
      loop, grid movement, collision, score = food eaten) — framework-free
      TS so it is trivially reusable inside the Telegram WebView too
- [ ] T037 [US2] `apps/web/src/components/games/neon-snake/NeonSnake.tsx`
      React wrapper: canvas mount, keyboard + touch-swipe controls, on-game-over
      callback
- [ ] T038 [P] [US2] `apps/web/src/app/games/page.tsx` — catalog grid (one
      card for now, structured for more per FR-019)
- [ ] T039 [US2] `apps/web/src/app/games/[slug]/page.tsx` — game page:
      renders `NeonSnake`, submits score via API only if logged in,
      shows post-game "log in to save your score" prompt for guests
- [ ] T040 [P] [US2] Per-game + global leaderboard components
      `apps/web/src/components/Leaderboard.tsx`, wired into game page and a
      `apps/web/src/app/leaderboard/page.tsx`
- [ ] T041 [P] [US2] Playwright smoke test `apps/web/e2e/games.spec.ts`
      covering guest play + logged-in score persisting to the leaderboard

**Checkpoint**: US1 + US2 both independently functional.

---

## Phase 5: User Story 3 - Follow the owner's feed and view public profiles (P3)

**Goal**: Public reverse-chronological feed (owner-authored only) and public
profile pages with derived activity stats.

**Independent Test**: Load `/` logged out and read a post; open any user's
`/u/[id]` profile page.

- [ ] T042 [P] [US3] `PostsService`/`PostsController` in
      `apps/api/src/posts/`: CRUD per contracts/api.md, Owner-guarded on
      write, public on read
- [ ] T043 [P] [US3] `UsersService`/`UsersController` in `apps/api/src/users/`:
      `GET /users/me`, `PATCH /users/me` (bio through moderation filter),
      `GET /users/:id` with derived stats (ideasSubmitted, ideasAccepted,
      gamesPlayed, bestScores) computed via Prisma aggregate queries
- [ ] T044 [P] [US3] API integration tests
      `apps/api/src/posts/posts.e2e-spec.ts` and
      `apps/api/src/users/users.e2e-spec.ts`
- [ ] T045 [P] [US3] `apps/web/src/app/page.tsx` — home feed, public, newest
      first, empty-state copy for zero posts
- [ ] T046 [P] [US3] `apps/web/src/app/u/[id]/page.tsx` — public profile:
      avatar/bio/name + `StatTile` row of derived stats
- [ ] T047 [US3] `apps/web/src/app/settings/page.tsx` — logged-in user's own
      profile editor (avatar/bio/displayName)
- [ ] T048 [US3] `apps/web/src/app/admin/posts/page.tsx` — owner post
      composer/editor/publish list
- [ ] T049 [P] [US3] Playwright smoke test `apps/web/e2e/feed-profile.spec.ts`

**Checkpoint**: US1 + US2 + US3 independently functional.

---

## Phase 6: User Story 4 - Use the whole platform from inside Telegram (P4)

**Goal**: Telegram Mini App parity via the same web app, Telegram Login on
web, and a bot process that opens it.

**Independent Test**: Open the Mini App from the bot, confirm auto-login,
perform one action from each of US1–US3 inside the Mini App.

- [ ] T050 [US4] `POST /auth/telegram` + `POST /auth/link/telegram` in
      `apps/api/src/auth/auth.controller.ts`, using T014's verifier
- [ ] T051 [P] [US4] `apps/web/src/components/TelegramLoginWidget.tsx` for
      the plain-browser login page (`apps/web/src/app/login/page.tsx`),
      alongside the email/password form
- [ ] T052 [US4] Wire `apps/web/src/lib/telegram.ts` (T019) into
      `apps/web/src/app/layout.tsx`: on Telegram runtime detection, silently
      call `/auth/telegram` with `initData` and skip the login screen
      entirely; hide `Navbar` in favor of Telegram `BackButton`/theme
- [ ] T053 [US4] Implement `apps/bot/src/index.ts`: grammy bot instance,
      sets the Mini App menu button to `WEB_ORIGIN`, minimal `/start`
      command replying with the same button (per FR-021)
- [ ] T054 [P] [US4] `apps/bot/README.md` documenting local tunneling
      (e.g. ngrok) for testing the Mini App button against a dev server
- [ ] T055 [P] [US4] Playwright/manual smoke checklist
      `apps/web/e2e/telegram-miniapp.md` (Playwright can't script real
      Telegram WebView — documents the manual verification steps from
      quickstart.md's P4 section instead)

**Checkpoint**: All four user stories functional; platform matches spec.md
in full.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T056 [P] `apps/web/src/app/admin/page.tsx` — admin dashboard home:
      `GET /admin/stats` counts as `StatTile`s, Bankdash-style layout
- [ ] T057 [P] `apps/web/src/app/admin/moderation/page.tsx` — moderation
      queue + audit log viewer (`GET /admin/moderation-queue`,
      `GET /admin/moderation-log`)
- [ ] T058 [P] `apps/api/src/admin/admin-users.controller.ts` — mute/ban
      endpoints, revoking refresh tokens on ban
- [ ] T059 [P] Responsive pass on all `apps/web` pages for mobile (primary
      surface given Telegram usage)
- [ ] T060 [P] `apps/api/Dockerfile`, `apps/web/Dockerfile`,
      `apps/bot/Dockerfile` — multi-stage, production builds
- [ ] T061 `infra/docker-compose.yml` composing `postgres`, `api`, `web`,
      `bot`, joined to the reverse-proxy network per research.md §7
- [ ] T062 `infra/nginx/zaa4eem.conf` — site block for `zaa4eem.ru` (proxies
      to `web`, `/api` to `api`), TLS via Certbot
- [ ] T063 `zaa4eem-site/DEPLOY.md` — step-by-step VPS deployment guide:
      env vars to fill, DNS records to add at reg.ru, `docker compose up`,
      migration command, Certbot command, Telegram bot menu-button setup —
      explicitly listing what access/secrets are needed from the owner
- [ ] T064 [P] `zaa4eem-site/README.md` — repo overview, links to spec-kit
      docs, local dev instructions (points to quickstart.md)
- [ ] T065 Run full quickstart.md validation pass across all four stories
      end-to-end locally before declaring the MVP done

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** → **Phase 2 (Foundational)**: strictly sequential,
  blocks everything else.
- **Phase 3 (US1)**, **Phase 4 (US2)**, **Phase 5 (US3)** are mutually
  independent after Phase 2 — can be built in any order or in parallel by
  different contributors.
- **Phase 6 (US4)** depends on US1–US3 existing (it mirrors them) plus its
  own T050 (Telegram auth) which only needs Phase 2.
- **Phase 7 (Polish)** depends on all prior phases (dashboards/docs
  reference every module) and is last.

## Parallel Execution Examples

- After Phase 2: one contributor takes T023-T032 (US1), another takes
  T033-T041 (US2), another T042-T049 (US3) — all touch disjoint files.
- Within Phase 2: T011, T012, T013, T014, T016, T017, T018, T019, T021 are
  all `[P]` — different files, no cross-dependency once T009/T010 (schema)
  land.

## Implementation Strategy

**MVP first**: Phases 1 → 2 → 3 (US1) alone is a demoable MVP — the Ideas
board is the platform's core promise per Constitution Principle I. Ship
Phase 4 (Games) next since it's the second brand pillar, then Phase 5
(Feed/profiles) to round out "personal site," then Phase 6 (Telegram) once
the web app has real content to mirror. Phase 7 closes with the actual
deployment.
