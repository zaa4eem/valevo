# Feature Specification: ZAA4EEM Platform (Site + Telegram Mini App)

**Feature Branch**: `zaa4eem-site`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "Хочу сделать сайт zaa4eem.ru как соц сеть и возможность для добавления мини игр и
возможность в них играть, + мини-апп в Telegram. Это мой личный сайт + возможность креатива для подписчиков:
они предлагают идеи, что добавить, а я добавляю то, что реально хайп. Домен zaa4eem.ru на рег.ру, хостинг —
тот же, что уже используется. Токен бота Telegram заполню сам. Стиль — Valevo, скрещённый с Bankdash
(Figma dashboard UI kit), в нежных зелёных и иных цветах, акцент зелёный; логотип и баннеры (чёрный фон,
неоновый зелёный, "ZAA4EEM — NO SIGNAL · STILL HERE — комьюнити · стримы · squad") прикреплены как референс."

## Clarifications

### Session 2026-09-02

- Q: Какой баланс между личным сайтом и соц-сетью для подписчиков нужен на старте? → A: Личный сайт + лёгкая соц-часть — сайт прежде всего витрина/блог владельца, соц-функции вторичны и минимальны на старте.
- Q: Какие соц-функции нужны в MVP? → A: Профили пользователей (аватар, ник, био, статистика) + лента постов от владельца. (Комментарии/реакции и личные сообщения — вне MVP, см. Assumptions.)
- Q: Как должен работать процесс «подписчики предлагают → владелец добавляет хайповое»? → A: Идеи + голосование, финальное решение всегда за владельцем. Голосование — сигнал, а не автоматическое одобрение.
- Q: Кто может публиковать контент на сайте? → A: Только владелец — лента объявлений (одностороннний канал).
- Q: В каком формате будут мини-игры? → A: Собственные HTML5/JS-игры, встроенные в сайт (не сторонние iframe).
- Q: Какие игровые соц-фичи важны? → A: Лидерборды — общий и по каждой игре.
- Q: Сколько мини-игр нужно к запуску? → A: 1 простая игра для обкатки концепции; дальше добавляются по фидбеку.
- Q: Подписчики предлагают только идеи игр или загружают код? → A: Только идеи — игры реализует владелец (сам или с помощью Claude Code).
- Q: Какую роль играет Telegram Mini App относительно сайта? → A: Полное зеркало сайта — все фичи сайта доступны и в мини-аппе.
- Q: Какие способы входа нужны? → A: Вход через Telegram (основной) + Email/пароль (запасной для не-Telegram пользователей).
- Q: Какой хостинг использовать? → A: Тот же VPS, на котором уже развёрнут бот Н12 (см. `Н12/docker-compose.yml`) — размещаем рядом, как отдельный сервис.
- Q: Какой технологический стек? → A: Node.js/TypeScript единым стеком (Next.js фронтенд + Node/NestJS бэкенд).
- Q: Нужна ли монетизация на старте? → A: Нет монетизации на старте (донаты/реклама/подписка — не MVP).
- Q: Какой подход к модерации контента? → A: Автоматический фильтр мата/запрещённого контента + ручная модерация владельцем.
- Q: Какая возрастная маркировка нужна? → A: 12+, без специальных ограничений.
- Q: На каком языке делать сайт? → A: Только русский.
- Q (unprompted, user-stated constraint): Сайт не должен нарушать законы РФ → A: Обязательное сквозное требование — см. `## Requirements` (RF-совместимость) и Constitution Principle II.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit an idea and watch it get picked up (Priority: P1)

A subscriber has a suggestion for what zaa4eem should add to the platform.
They submit it to the public Ideas board, other subscribers upvote it, and
the owner reviews the board, picks the most "hype" idea, and marks it as
accepted/in-progress/shipped — visibly, so the submitter and the community
can see their idea moved forward.

**Why this priority**: This is the differentiator that makes the platform
more than a personal blog — subscribers literally see their own contribution
reflected on the site. It is the core promise made to the audience.

**Independent Test**: Can be fully tested by submitting an idea as a logged-in
user, having a second user upvote it, and having the owner change its status
from the admin panel — all visible on the public Ideas board without any
other feature (games, feed) needing to exist yet.

**Acceptance Scenarios**:

1. **Given** a logged-in subscriber, **When** they submit an idea with a title
   and description, **Then** it appears on the public Ideas board with a
   status of "New" after passing the automated content filter.
2. **Given** an idea on the board, **When** another logged-in subscriber
   upvotes it, **Then** its vote count increases and each subscriber can vote
   at most once per idea.
3. **Given** the owner viewing the admin panel, **When** they change an
   idea's status (Under review / Accepted / In progress / Shipped /
   Declined), **Then** the new status is immediately visible on the public
   board and to the original submitter.
4. **Given** an idea that fails the automated content filter, **When** it is
   submitted, **Then** it is held for owner review instead of publishing
   immediately.

---

### User Story 2 - Play the launch mini-game and climb the leaderboard (Priority: P2)

A visitor opens the Games section, plays the featured mini-game in the
browser (or inside the Telegram Mini App), and — once logged in — has their
best score recorded on a public leaderboard alongside other players.

**Why this priority**: Games are the second pillar of the platform and the
main reason for return visits; they need to work end-to-end even before a
second game or advanced social features exist.

**Independent Test**: Can be fully tested by opening the games catalog,
playing the one launch game to completion, logging in, and confirming the
resulting score appears on that game's leaderboard and the global
leaderboard.

**Acceptance Scenarios**:

1. **Given** a visitor on the Games page, **When** they select the launch
   game, **Then** it loads and is playable directly in the browser without
   installing anything.
2. **Given** a logged-in player who finishes a game session, **When** their
   score beats their previous best, **Then** their leaderboard entry updates
   to the new score.
3. **Given** the per-game leaderboard, **When** viewed by anyone, **Then** it
   shows top players ranked by score with each player's public profile name.
4. **Given** a guest (not logged in) playing the game, **When** they finish,
   **Then** they can see their own score but are prompted to log in before it
   is saved to any leaderboard.

---

### User Story 3 - Follow the owner's feed and view public profiles (Priority: P3)

Any visitor can land on zaa4eem's public profile/feed, read posts and
updates from the owner, and view any subscriber's public profile (avatar,
bio, activity stats such as ideas submitted and games played).

**Why this priority**: This is the "personal site" pillar — it must exist and
work independently of the community features so the site delivers value from
day one even while the Ideas/Games pillars are still shallow.

**Independent Test**: Can be fully tested by loading the home feed as a
logged-out visitor, reading a post, and navigating to any user's public
profile page.

**Acceptance Scenarios**:

1. **Given** any visitor, **When** they open the home page, **Then** they see
   the owner's feed of posts in reverse-chronological order without needing
   to log in.
2. **Given** a registered subscriber, **When** they complete their profile
   (avatar, bio), **Then** their public profile page shows this information
   plus their idea/game activity stats.
3. **Given** the owner, **When** they publish a new post, **Then** it appears
   at the top of the feed for all visitors immediately.

---

### User Story 4 - Use the whole platform from inside Telegram (Priority: P4)

A Telegram user opens the zaa4eem Mini App from the bot, is signed in
automatically via Telegram, and has access to the same feed, Ideas board,
profile, and games as on the website — without needing a separate account.

**Why this priority**: Telegram is a primary distribution channel for this
audience, but it depends on the website's core features (P1-P3) already
existing to mirror.

**Independent Test**: Can be fully tested by opening the Mini App from the
Telegram bot, confirming automatic sign-in, and performing one action from
each of P1-P3 (submit an idea, play the game, view a profile) inside the
Mini App.

**Acceptance Scenarios**:

1. **Given** a Telegram user opening the Mini App for the first time,
   **When** it loads, **Then** they are signed in automatically using their
   verified Telegram identity, with no separate registration step.
2. **Given** a user signed in through Telegram, **When** they later open the
   website in a regular browser and log in with the same Telegram account,
   **Then** they see the same profile, ideas, votes, and scores (single
   unified account, not a duplicate).
3. **Given** any feature available on the website, **When** accessed from the
   Mini App, **Then** it behaves the same way (same data, same actions).

---

### Edge Cases

- What happens when an idea's automated filter flags it, but the owner later
  approves it manually? → It publishes with the owner's approval logged in
  the moderation log.
- What happens when the same person uses both Telegram login and email/
  password with the same email/Telegram-linked address? → The system must
  offer account linking rather than silently creating a duplicate account.
- How does the leaderboard handle a suspiciously high score (possible
  cheating)? → Scores above a sane per-game ceiling are held for owner
  review instead of publishing automatically.
- What happens when a subscriber tries to vote on their own idea, or vote
  twice on the same idea? → Both are blocked; one vote per idea per user,
  self-votes allowed but only once like anyone else.
- What happens when the owner declines an idea? → It stays visible on the
  board (not deleted) marked "Declined" so history and community trust are
  preserved, unless it also violates content policy, in which case it is
  removed and logged.
- What happens if idea submissions are flooded (spam)? → Rate limiting caps
  submissions per user per time window; repeat offenders can be muted by the
  owner.
- What happens when the Telegram bot token or Mini App is temporarily
  unavailable? → The website continues to function fully on its own; Telegram
  is an additional surface, not a single point of failure.
- What happens to a user's data if they delete their account? → Personal
  data is removed/anonymized per 152-ФЗ expectations; their public
  contributions (accepted ideas, leaderboard history) may be retained
  attributed to "deleted user" rather than cascading deletes that break
  public history.

## Requirements *(mandatory)*

### Functional Requirements

**Accounts & Identity**

- **FR-001**: System MUST allow sign-in via Telegram (Telegram Login Widget /
  Mini App `initData`), verified server-side using Telegram's official
  signature verification — never trusting client-supplied identity claims.
- **FR-002**: System MUST allow sign-in via email + password as a fallback
  for users without Telegram, with passwords stored using a modern salted
  hash (bcrypt/argon2), never in plaintext.
- **FR-003**: System MUST treat a Telegram-linked account and its
  email/password login (when both are set on the same account) as a single
  unified identity — one profile, one set of ideas/votes/scores.
- **FR-004**: Every registered user MUST have a public profile with avatar,
  display name, bio, and derived activity stats (ideas submitted, ideas
  accepted, games played, best scores).
- **FR-005**: Users MUST be able to edit their own profile fields; the owner
  account MUST be distinguishable as the platform owner on their profile.

**Feed**

- **FR-006**: System MUST provide a public, reverse-chronological feed of
  posts authored only by the owner account (per FR-clarification: only the
  owner publishes to the feed in MVP).
- **FR-007**: The feed MUST be viewable by anyone without logging in.
- **FR-008**: The owner MUST be able to create, edit, and delete their own
  posts from an admin/authoring interface.

**Ideas Board**

- **FR-009**: Logged-in users MUST be able to submit an idea (title +
  description) to a public Ideas board.
- **FR-010**: Every submitted idea MUST pass an automated content filter
  (profanity / banned content) before becoming publicly visible; content that
  fails the filter is held in a moderation queue instead of being discarded.
- **FR-011**: Logged-in users MUST be able to upvote any idea exactly once;
  vote counts MUST be visible on the board.
- **FR-012**: The owner MUST be able to change an idea's status (e.g. New →
  Under review → Accepted → In progress → Shipped, or → Declined) from an
  admin interface, and the current status MUST be visible on the public
  board.
- **FR-013**: The Ideas board MUST support sorting by most-voted and by
  newest.
- **FR-014**: System MUST rate-limit idea submissions per user to prevent
  spam flooding.

**Mini-Games**

- **FR-015**: System MUST provide a Games catalog listing available
  mini-games, launching with exactly one playable HTML5/JS game built for
  the platform (not a third-party embed).
- **FR-016**: Visitors MUST be able to play the launch game without logging
  in (guest play).
- **FR-017**: System MUST record a logged-in player's best score per game and
  display it on a per-game leaderboard, plus a global leaderboard aggregating
  activity across games.
- **FR-018**: System MUST reject or hold-for-review scores that exceed a
  configurable, game-specific plausibility ceiling, to guard against obvious
  score manipulation.
- **FR-019**: The Games catalog MUST be structured so additional games can be
  added later without a redesign (catalog is not hard-coded to a single
  game).

**Telegram Mini App**

- **FR-020**: System MUST expose a Telegram Mini App that provides full
  feature parity with the website: feed, profiles, Ideas board (submit/vote),
  and Games — reusing the same backend and data as the website.
- **FR-021**: The Telegram bot MUST provide an entry point (menu button /
  command) that opens the Mini App.
- **FR-022**: The Telegram bot token MUST be supplied via environment
  configuration by the owner and never committed to the repository.

**Moderation & Admin**

- **FR-023**: The owner MUST have an admin interface to: review/moderate
  flagged content, manage idea statuses, publish feed posts, and view basic
  site/user activity.
- **FR-024**: Every moderation action (approve, decline, remove, ban/mute)
  MUST be recorded in an audit log with actor, target, timestamp, and reason.
- **FR-025**: The owner MUST be able to mute or ban a user to stop further
  submissions/votes/comments from that account.

**Legal / RF Compliance**

- **FR-026**: System MUST store personal data of users primarily on
  infrastructure located in the Russian Federation (152-ФЗ compliance).
- **FR-027**: All user-generated content surfaces (idea title/description,
  profile bio) MUST be covered by the automated content filter from FR-010;
  no free-text field ships without a moderation path.
- **FR-028**: The site MUST display a 12+ content rating and MUST NOT host
  content that would require a stricter age gate (18+, gambling, etc.)
  without this specification being revisited first.
- **FR-029**: System MUST NOT implement any real-money mechanic (payments,
  betting, loot-box style purchases) in this MVP, consistent with "no
  monetization at launch."

### Key Entities

- **User**: A registered person. Attributes: display name, avatar, bio,
  auth identities (Telegram ID and/or email+password hash), role (owner /
  subscriber), status (active/muted/banned), created date.
- **Post**: An owner-authored feed item. Attributes: author (always owner),
  body content, published timestamp, edit history.
- **Idea**: A subscriber-submitted suggestion. Attributes: submitter, title,
  description, status (New/Under review/Accepted/In progress/Shipped/
  Declined), vote count, created timestamp, moderation state.
- **Vote**: A single user's upvote on a single idea. Attributes: user, idea,
  timestamp. Unique per (user, idea) pair.
- **Game**: A catalog entry for a mini-game. Attributes: title, description,
  thumbnail, play-count, score plausibility ceiling.
- **Score**: A recorded result of one user playing one game. Attributes:
  user, game, value, timestamp, review-state (normal/held-for-review).
- **Leaderboard Entry**: Derived view of a user's best Score per game (and
  aggregated globally); not stored independently of Score.
- **ModerationLogEntry**: Record of an owner moderation action. Attributes:
  actor (owner), target entity (idea/post/user/comment), action taken,
  reason, timestamp.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A logged-in subscriber can submit an idea and see it live on
  the public Ideas board (or in the moderation queue) in under 1 minute.
- **SC-002**: A visitor can go from landing on the Games page to playing the
  launch game in under 15 seconds, with no account required.
- **SC-003**: 100% of the features available on the website (feed, profile,
  Ideas board, Games) are also available and functionally identical inside
  the Telegram Mini App at launch.
- **SC-004**: 100% of publicly visible user-generated text (ideas, bios) has
  passed the automated content filter before being shown to other users.
- **SC-005**: The owner can review and resolve (approve/decline/status-change)
  a backlog of 20 pending ideas in under 10 minutes using the admin panel.
- **SC-006**: Zero instances of a Russian user's personal data stored outside
  RF-based infrastructure, verified at deployment time.
- **SC-007**: A returning player's best score and rank are visible on the
  leaderboard within 5 seconds of finishing a game session.

## Post-MVP: v1.0.1

Shipped after the MVP launch — supersedes the "comments/reactions/owner-only
posting" assumptions below for the feed specifically (Ideas board scoping is
unchanged):

- Likes and comments on feed posts (comments pass the same moderation filter
  as ideas/bios: held for owner review, never silently deleted).
- Any logged-in user (not just the owner) may publish a feed post, limited to
  one per 12 hours; the owner keeps unlimited/draft posting.
- Real avatar image upload (JPEG/PNG/WEBP/GIF, 3MB limit) replacing the
  URL-only avatar field.
- A short "status" text next to a user's display name (profile + settings).
- Mobile viewport tuning for the Telegram Mini App (pinned zoom, larger touch
  targets, safe-area padding).

## Assumptions

- Comments/reactions on posts and ideas, and direct messages between users,
  are explicitly **out of scope for MVP** (not selected when the social
  feature set was scoped) and are candidate Phase 2 features driven by the
  Ideas board itself. (Post comments/reactions shipped in v1.0.1 above —
  idea comments and DMs remain out of scope.)
- Guest (non-logged-in) users may browse the feed, Ideas board, and play the
  launch game, but must log in to submit ideas, vote, or save a score to a
  leaderboard — this "browse free, log in to participate" pattern is a
  reasonable default consistent with maximizing top-of-funnel visitors while
  keeping community actions accountable.
- The visual design system is derived from the attached ZAA4EEM logo/banner
  references (near-black background, neon/mint-green accent, bold condensed
  white headers, small square bullet accents) fused with a Bankdash-style
  card/sidebar dashboard structure for the admin panel and profile/stat
  surfaces — recolored to the zaa4eem dark-green palette rather than
  Bankdash's original light theme. Exact design tokens are finalized during
  `/speckit-plan`, not this spec.
- Deployment target is the existing VPS already running the `Н12` Telegram
  bot (see `Н12/docker-compose.yml`), added as a new, isolated set of
  containers (web app, API, database) alongside it — not sharing its
  database or codebase. Exact server access handoff and `zaa4eem.ru` DNS
  configuration (currently on reg.ru) happen during deployment and do not
  block spec/plan/tasks work.
- The Telegram bot token will be supplied by the owner via environment
  configuration when deployment begins; it is out of scope for this spec to
  define its value.
- "Hype" curation is manual and qualitative — there is no automatic
  vote-count threshold that force-ships an idea; the owner's judgment is
  always the deciding factor (per Constitution Principle I).
