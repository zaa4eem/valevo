# API Contract: ZAA4EEM Platform (`apps/api`)

Base URL: `/api`. All responses JSON. Auth via `Authorization: Bearer <JWT>`
or the `zaa4eem_session` cookie (web). Endpoints marked **Owner** require
`role = OWNER`; **Auth** requires any logged-in user; unmarked = public.

## Auth

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | `/auth/telegram` | public | `{ initData: string }` → `{ user, accessToken }` — verifies per research.md §2 |
| POST | `/auth/register` | public | `{ email, password, displayName }` → `{ user, accessToken }` |
| POST | `/auth/login` | public | `{ email, password }` → `{ user, accessToken }` |
| POST | `/auth/refresh` | cookie | rotates refresh token → `{ accessToken }` |
| POST | `/auth/logout` | Auth | revokes current refresh token → `204` |
| POST | `/auth/link/telegram` | Auth | `{ initData }` — links Telegram identity to current account |

## Users / Profiles

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/users/me` | Auth | current user + stats |
| PATCH | `/users/me` | Auth | update `displayName`, `avatarUrl`, `bio` (bio passes moderation filter) |
| GET | `/users/:id` | public | public profile + derived stats (FR-004) |

## Feed

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/posts` | public | paginated, `publishedAt` not null, newest first |
| POST | `/posts` | Owner | create; `publishedAt` set on create or via publish endpoint |
| PATCH | `/posts/:id` | Owner | edit |
| DELETE | `/posts/:id` | Owner | delete |

## Ideas

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/ideas` | public | `?sort=top\|new`, paginated; only `moderationState in (CLEAN, APPROVED)` visible to non-owner |
| POST | `/ideas` | Auth | rate-limited (research.md §6); runs moderation filter (FR-010) |
| GET | `/ideas/:id` | public | single idea + vote state for current user if authed |
| POST | `/ideas/:id/vote` | Auth | idempotent-once (unique constraint) → `409` if already voted |
| DELETE | `/ideas/:id/vote` | Auth | remove own vote |
| PATCH | `/ideas/:id/status` | Owner | body `{ status }` — moves through the FR-012 status lifecycle |
| PATCH | `/ideas/:id/moderation` | Owner | body `{ moderationState }` — approve/remove a pending item |

## Games & Scores

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/games` | public | active catalog entries |
| GET | `/games/:slug` | public | game detail |
| POST | `/games/:slug/scores` | Auth | body `{ value }`; guest play is client-only (FR-016) — nothing to submit until logged in |
| GET | `/games/:slug/leaderboard` | public | top N by best `NORMAL` score |
| GET | `/leaderboard/global` | public | top N aggregated across games |

## Admin / Moderation

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/admin/moderation-queue` | Owner | pending ideas/bios/scores awaiting review |
| GET | `/admin/moderation-log` | Owner | audit trail (FR-024), paginated |
| POST | `/admin/users/:id/mute` | Owner | body `{ reason }` |
| POST | `/admin/users/:id/ban` | Owner | body `{ reason }`; revokes all refresh tokens |
| GET | `/admin/stats` | Owner | basic counts for the dashboard (users, ideas by status, plays) |

## Error shape

```json
{ "statusCode": 400, "error": "ValidationError", "message": "..." }
```

Validation on every write endpoint is via shared Zod schemas in
`packages/shared`, used both by NestJS pipes (server) and Next.js forms
(client) so validation rules are defined exactly once.
