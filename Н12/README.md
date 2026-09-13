# VALEVO Н12 — Production Ready integration

Target: `zaa4eem/valevo` → `main` → `Н12`.
Audited base commit: `5c946a8f17df387d384fb108520cb7db505645fa`.

This package upgrades the existing bot without replacing the tournament/TV-board logic. It focuses on the production path requested for Telegram Mini App + booking + finance + super-admin operations.

## Included

### Telegram Mini App

- Booking screen with place/type/date/time/duration selection.
- Live price quote and local availability preview.
- Server-side final availability check before a booking is committed.
- My bookings, status, saved quoted price and payment state.
- Rating TOP-7 + discipline tables.
- Roulette + Valevo Bonus balance.
- Referral link/statistics.
- Pilot profile.
- Super-admin panel (hidden for other users **and** protected server-side).
- Problem/recovery screen for failed YCLIENTS cancellation/rollback.
- Responsive mobile UI, Telegram haptics/confirmations and safe error states.

### Booking safety

- Request idempotency via `request_token` — double tap/retry does not create a second booking.
- Local SQLite transaction protects simultaneous attempts for the same slot.
- Cancellation uses an atomic `cancelling` claim to stop parallel deletes.
- `cancellation_failed` and `rollback_failed` remain **blocking** statuses.
- Successful partial external deletions are cleared locally immediately; retry only touches remaining records.
- Failed approval rollback never makes an occupied simulator appear free.
- Safe super-admin retry cleanup; slot is released only after all external records are removed.
- Tariff and total are snapshotted into the booking at creation.

### Finance

- Append-only payment/refund journal.
- DB triggers reject UPDATE/DELETE of financial rows.
- Idempotent finance operations via `operation_key`.
- Payment cannot exceed the booking quote when a quote exists.
- Refund cannot exceed registered net paid amount.
- Commission is calculated only on registered payments/refunds and snapshotted per row.
- Tariff/commission changes are audited and never recalculate old bookings.
- Admin audit log for finance/settings/moderation/recovery actions.
- Conservative default commission: `0%` until configured by super-admin.

### Production hardening

- JSON error handling; internal exceptions are not exposed to users.
- Telegram `initData` remains the authentication boundary.
- Mutation rate limiter to absorb button-spam.
- Security headers / CSP.
- `/api/health` liveness and `/api/ready` DB/schema readiness.
- Safe `.env.example` with placeholders only.
- Hardened Docker Compose: healthchecks, localhost-only WebApp port, log rotation, no-new-privileges, dropped capabilities.
- Nginx HTTPS example with API rate limiting.
- Static + runtime production preflight script.
- Network-free finance integration test.
- Transactional installer: if apply/check fails it restores every touched file.

## Apply

From the `valevo` repository root:

```bash
python /path/to/valevo_prod_ready/apply_to_repo.py .
```

The installer:

1. refuses dirty touched files by default;
2. runs `git apply --check` against the current source;
3. applies booking/config migrations;
4. installs the Mini App + finance service + deploy files;
5. runs Python compile checks, JS syntax check when Node exists, and static preflight;
6. runs the local finance integration test when `aiosqlite` is installed;
7. restores all touched files automatically if any step fails.

Then:

```bash
cd Н12
cp .env.example .env
# fill NEW rotated secrets and production values
python scripts/preflight_production.py
docker compose build --pull
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:${WEBAPP_PORT:-8080}/api/ready
```

Read `deploy/PRODUCTION_RUNBOOK.md` before the live switch.

## Mandatory before production

A previous Git commit contained real-looking credentials. Git history keeps deleted values. Rotate the Telegram bot token and YCLIENTS tokens before deploying this build. The package intentionally contains **no** real credentials.

## Defaults added to config

```text
BOOKING_STATIC_RUB_PER_HOUR=700
BOOKING_MOTION_RUB_PER_HOUR=700
BOOKING_COMMISSION_PERCENT=0
```

Set the real tariffs/commission in `.env` or from the super-admin Mini App. Old bookings keep their original saved quote.

## Scope of local verification

The package can validate syntax, schema/finance invariants and deployment configuration locally. It does not call real Telegram/YCLIENTS during automated tests. The final external smoke test is documented in the production runbook and must be performed with the newly rotated production credentials.
