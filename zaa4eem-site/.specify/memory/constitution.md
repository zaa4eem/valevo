# ZAA4EEM Constitution

## Core Principles

### I. Community-Driven, Owner-Curated
Subscribers propose ideas through the public Ideas board; the community upvotes
them; the owner (zaa4eem) always makes the final call on what gets built.
Voting surfaces signal — it never auto-approves or auto-rejects a feature.
Every shipped feature should be traceable back to an idea a subscriber
submitted, or an explicit owner decision. This is the product's core loop and
must never be short-circuited by giving votes unilateral authority.

### II. RF Legal Compliance (NON-NEGOTIABLE)
The platform targets a Russian audience and MUST comply with Russian law at
all times:
- Personal data of users MUST be stored primarily on servers located in the
  Russian Federation (152-ФЗ). No user PII may be replicated to non-RF
  infrastructure without explicit review.
- All user-generated content (comments, idea submissions, profile fields)
  MUST pass automated filtering (profanity / banned-content) before
  publication, backed by manual owner moderation for anything flagged or
  reported.
- Site content is rated 12+; nothing requiring age-gating (18+ material,
  gambling, etc.) may be added without revisiting this principle first.
- No feature may be shipped that facilitates the distribution of content
  prohibited under RF law (extremism, illegal gambling/lotteries without a
  license, etc.).
- When in doubt, the compliant-but-slower option always wins over the
  faster-but-risky one.

### III. Telegram-Native, Website-Equal
The Telegram Mini App is a full mirror of the website, not a stripped-down
companion. A feature is not "done" until it works in both surfaces sharing
the same backend and business logic. Telegram Login is the primary
authentication path; email/password is the fallback for non-Telegram users.

### IV. One Codebase, One Language
The stack is TypeScript end-to-end (Next.js frontend + Node/NestJS backend,
shared types/schemas). Avoid introducing a second backend language unless a
capability genuinely cannot be met in the existing stack. This keeps a
one-person-maintained project sustainable.

### V. Dark Neon Identity, Dashboard Structure
Every screen follows the shared zaa4eem design system: near-black surfaces,
neon/mint-green accent (`#4ADE80`-family), bold condensed headers, small
square bullet accents — fused with a clean, card-based dashboard layout
(sidebar nav, stat tiles, rounded panels) in the spirit of the Bankdash
reference. New UI is never designed ad hoc; it extends the shared component
library and token set.

### VI. Simple MVP, Earn Complexity
Ship the smallest version of every feature first: one mini-game before a
catalog, no monetization before there's an audience to monetize, single-player
before multiplayer, manual moderation before automated pipelines beyond a
basic filter. Complexity is added only once real usage demonstrates the need.

## Security & Data Requirements

- Telegram authentication MUST be verified server-side using Telegram's
  official `initData` / login-widget HMAC verification — never trust
  client-supplied Telegram identity claims unverified.
- Passwords (for the email/password fallback) MUST be hashed with a modern,
  salted algorithm (scrypt/bcrypt/argon2); plaintext or reversible storage
  is forbidden.
- Idea submissions, comments, and profile fields are rate-limited to prevent
  spam and abuse.
- Every moderation action (content removed, idea rejected/approved, user
  banned) MUST be logged with actor, timestamp, and reason for accountability.
- Secrets (Telegram bot token, DB credentials, session secrets) are only ever
  supplied via environment variables / server-side secret storage, never
  committed to the repository.

## Development Workflow

- Features are specified (`specs/<feature>/spec.md`) before planning, and
  planned before implementation, per the spec-kit workflow installed in this
  project (`/speckit-plan`, `/speckit-tasks`, `/speckit-implement`).
- The existing `Н12` Telegram bot (karting club booking system) is a
  separate, unrelated project living in the same repository. Nothing in
  `zaa4eem-site/` may depend on or modify it; they may share hosting
  infrastructure only.
- Target deployment: the existing VPS already hosting the `Н12` bot,
  containerized (Docker), reachable at the `zaa4eem.ru` domain (registered on
  reg.ru). Exact server access/DNS handoff happens during the deployment
  phase and does not block specification or planning work.

## Governance

This constitution supersedes ad hoc technical or product decisions for the
zaa4eem platform. Any change to a Core Principle requires updating this file
with a version bump and a one-line rationale in the amendment history below.
Feature specs and plans must be checked against these principles before
`/speckit-implement` runs; a conflict is resolved by amending the spec, not
by silently violating the constitution.

**Version**: 1.0.0 | **Ratified**: 2026-09-02 | **Last Amended**: 2026-09-02
