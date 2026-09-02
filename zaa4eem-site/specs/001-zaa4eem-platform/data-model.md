# Phase 1 Data Model: ZAA4EEM Platform

Source of truth is `apps/api/prisma/schema.prisma`; this document is the
human-readable summary. Enum values and field names here MUST match the
Prisma schema exactly.

## User

Represents a registered person — the platform owner or a subscriber.

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| role | enum `OWNER` \| `SUBSCRIBER` | exactly one `OWNER` row exists |
| status | enum `ACTIVE` \| `MUTED` \| `BANNED` | default `ACTIVE` |
| displayName | string | shown publicly |
| avatarUrl | string? | nullable, default placeholder used if unset |
| bio | string? | passes moderation filter before save |
| telegramId | bigint? | unique, nullable — set when Telegram identity linked |
| telegramUsername | string? | cached display value only |
| email | string? | unique, nullable — set when email/password identity linked |
| passwordHash | string? | argon2 hash, nullable (Telegram-only users have none) |
| createdAt | datetime | |
| updatedAt | datetime | |

**Validation**: at least one of (`telegramId`, `email`+`passwordHash`) MUST
be set — a User always has ≥1 usable login method (FR-001–FR-003).

**Derived (not stored)**: ideasSubmittedCount, ideasAcceptedCount,
gamesPlayedCount, bestScoresByGame — computed from related rows for profile
display (FR-004).

## RefreshToken

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| userId | uuid | FK → User |
| tokenHash | string | hashed, never store raw token |
| expiresAt | datetime | |
| revokedAt | datetime? | set on logout/ban |

## Post

Owner-authored feed item (FR-006–FR-008).

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| authorId | uuid | FK → User; MUST be the `OWNER` user (enforced in service layer) |
| body | text | rich-text/markdown source |
| publishedAt | datetime | null while draft |
| createdAt / updatedAt | datetime | |

## Idea

Subscriber-submitted suggestion on the public board (FR-009–FR-013).

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| submitterId | uuid | FK → User |
| title | string | ≤120 chars |
| description | text | ≤2000 chars |
| status | enum `NEW` \| `UNDER_REVIEW` \| `ACCEPTED` \| `IN_PROGRESS` \| `SHIPPED` \| `DECLINED` | default `NEW` |
| moderationState | enum `CLEAN` \| `PENDING_REVIEW` \| `APPROVED` \| `REMOVED` | default set by filter result (research.md §3) |
| voteCount | int | denormalized cache of `Vote` count, updated transactionally |
| createdAt / updatedAt | datetime | |

**State transitions**: `status` moves forward through the enum order via
owner action only (admin API); `DECLINED` reachable from any non-terminal
state. `moderationState` starts `CLEAN` or `PENDING_REVIEW` from the filter,
owner can move `PENDING_REVIEW` → `APPROVED` (publishes) or → `REMOVED`.

## Vote

One user's upvote on one idea (FR-011).

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| ideaId | uuid | FK → Idea |
| userId | uuid | FK → User |
| createdAt | datetime | |

**Constraint**: unique on (`ideaId`, `userId`) — enforces "one vote per idea
per user" at the DB level, not just in application code.

## Game

Catalog entry for a mini-game (FR-015, FR-019).

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| slug | string | unique, URL-safe (e.g. `neon-snake`) |
| title | string | |
| description | string | |
| thumbnailUrl | string? | |
| maxPlausibleScore | int | per-game ceiling (research.md §5) |
| isActive | boolean | catalog can hide a game without deleting history |
| createdAt | datetime | |

## Score

One recorded play result (FR-017–FR-018).

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| gameId | uuid | FK → Game |
| userId | uuid | FK → User |
| value | int | |
| reviewState | enum `NORMAL` \| `HELD_FOR_REVIEW` | set `HELD_FOR_REVIEW` when `value > game.maxPlausibleScore` |
| createdAt | datetime | |

**Leaderboard read model**: per-game leaderboard = `MAX(value)` per user
where `reviewState = NORMAL`, ordered desc; global leaderboard = sum of each
user's best score across games. Computed via query/materialized view, not a
separately stored entity (per spec Key Entities: "Leaderboard Entry ... not
stored independently of Score").

## ModerationLogEntry

Audit trail for owner moderation actions (FR-024).

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| actorId | uuid | FK → User (always the `OWNER`) |
| targetType | enum `IDEA` \| `POST` \| `USER` \| `SCORE` | |
| targetId | uuid | polymorphic reference, not a DB FK (cross-table) |
| action | string | e.g. `approve`, `decline`, `remove`, `mute`, `ban` |
| reason | string? | |
| createdAt | datetime | |

## Entity relationships

```text
User 1──* Post            (author)
User 1──* Idea             (submitter)
User 1──* Vote             (voter)
Idea 1──* Vote
User 1──* Score            (player)
Game 1──* Score
User 1──* RefreshToken
User 1──* ModerationLogEntry (actor)
```
