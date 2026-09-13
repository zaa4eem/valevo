# VALEVO Н12 — production hardening test report

Date: 2026-09-13
Target audited main: `5c946a8f17df387d384fb108520cb7db505645fa`

## Completed in this environment

- Python syntax/bytecode compilation for every Python file in the package: **PASS**.
- JavaScript syntax check (`node --check`) for Mini App `app.js`: **PASS**.
- Docker Compose YAML parse: **PASS**.
- Unified patch format parse (`git apply --stat --recount`): **PASS**.
- Static production preflight with a synthetic target tree: **PASS**.
- Finance service exercised using the real `services/booking_finance.py` against a temporary SQLite database through an async compatibility harness: **PASS**.
  - tariff setting / quote;
  - payment registration;
  - operation-key idempotency;
  - refund registration;
  - over-refund rejection;
  - commission snapshot / net commission calculation;
  - admin audit creation.
- Append-only SQLite triggers: attempted UPDATE and DELETE of a finance row were both rejected: **PASS**.
- Static safety assertions in booking patch: **PASS**.
  - `cancellation_failed` and `rollback_failed` block the slot;
  - atomic `cancelling` claim exists;
  - partial successful external deletes are cleared locally;
  - request idempotency exists;
  - tariff snapshot exists;
  - failed rollback moves to `rollback_failed`.

## Not executed here

This environment has no external network access and does not contain the project's full installed runtime dependencies/production secrets, therefore these tests must be executed on the target server before opening the feature to users:

- real Telegram Mini App initData flow;
- Telegram Bot API messages/callbacks;
- real YCLIENTS availability/create/delete operations;
- HTTPS certificate / Nginx routing on the production domain;
- actual production DB migration on a **copy** of `valevo.db` first;
- full user → super-admin → YCLIENTS end-to-end smoke test.

The exact live smoke-test sequence is in `deploy/PRODUCTION_RUNBOOK.md`.

## Security blocker before live switch

Historical Git commits contained real-looking credentials. Production must use newly rotated Telegram/YCLIENTS credentials. The package ships only placeholders and intentionally does not contain secrets.
