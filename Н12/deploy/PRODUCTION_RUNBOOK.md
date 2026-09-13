# VALEVO Н12 — production runbook

This patch is prepared for `zaa4eem/valevo`, folder `Н12`, against audited `main` commit `5c946a8f17df387d384fb108520cb7db505645fa`.
The installer runs `git apply --check` and refuses incompatible source automatically.

## 0. Mandatory secret rotation

A historical commit contained real-looking Telegram/YCLIENTS credentials. Removing a file does **not** remove it from Git history.
Before production:

1. Revoke/rotate the Telegram bot token in BotFather.
2. Rotate YCLIENTS partner/user tokens.
3. Put only the new values in server-side `.env`.
4. Never commit `.env`; `.gitignore` already keeps it out of Git.

Do not reuse any old token even if it still works.

## 1. Apply

From the repository root:

```bash
python /path/to/valevo_prod_ready/apply_to_repo.py .
cd Н12
cp .env.example .env
```

Fill `.env` with the newly rotated credentials and real production values. Set a real `WEBAPP_URL=https://...` and verify `SUPER_ADMIN_IDS`.

## 2. Preflight and backup

```bash
python scripts/preflight_production.py
mkdir -p backups
cp -a data/valevo.db "backups/valevo-before-prod-$(date +%Y%m%d-%H%M%S).db"
```

If the DB is stored elsewhere, back up the actual `DB_NAME` path instead.

## 3. Build and start

```bash
docker compose build --pull
docker compose up -d
docker compose ps
```

Both `valevo-bot` and `valevo-webapp` must become healthy.

Local probes:

```bash
curl -fsS http://127.0.0.1:${WEBAPP_PORT:-8080}/api/health
curl -fsS http://127.0.0.1:${WEBAPP_PORT:-8080}/api/ready
```

Expected: `{"ok":true}`.

## 4. HTTPS / reverse proxy

Install `deploy/nginx-valevo.conf.example`, replace the domain and certificate paths, then:

```bash
nginx -t && systemctl reload nginx
curl -fsS https://YOUR_DOMAIN/api/ready
```

Telegram Mini Apps require a valid public HTTPS URL. Configure that exact URL in BotFather / the bot menu button and in `WEBAPP_URL`.

## 5. Required smoke test in Telegram

Use one ordinary pilot and one super-admin account:

1. Open Mini App from Telegram. `/api/me` must identify the correct account.
2. Create a booking for one free simulator. Double-tap submit: only **one** booking must exist.
3. Super-admin approves it. Confirm that the YCLIENTS record exists.
4. Register a partial payment, then the rest. A third payment above the quoted total must be rejected.
5. Register a refund. Refund above net paid amount must be rejected.
6. Change the tariff. Existing booking price must remain unchanged; a new booking must use the new tariff.
7. Cancel a future confirmed booking. Verify the YCLIENTS record disappears and the slot becomes available.
8. Simulate/observe an external cancellation failure if possible: status must become `cancellation_failed`, slot must stay blocked, and the problem must appear in super-admin Mini App.
9. Use **Safe cleanup** from the problem card; slot may be released only after every external record is actually removed.
10. Verify financial journal and admin audit contain the expected entries.

## 6. Role check

- `ADMIN_IDS`: limited ordinary admin permissions configured by the bot (existing requirement: time entry only).
- `SUPER_ADMIN_IDS`: booking moderation, tariff/commission changes, finance journal, recovery actions.
- Mini App privileged endpoints validate `is_super_admin` server-side; hiding a button is not the security boundary.

## 7. Finance invariants

- Booking tariff and total are snapshotted at booking creation.
- Ledger rows are append-only at SQLite level; corrections are compensating payment/refund entries.
- Refund cannot exceed registered net payment.
- Payment cannot exceed the booking's saved quoted total when a quote exists.
- Commission is calculated only from registered payment/refund rows and snapshotted per row.
- Default commission is `0%` until super-admin sets the real percentage.

## 8. Rollback

Before a deploy, keep the DB backup and record the previous Git commit.

```bash
git rev-parse HEAD
docker compose down
# checkout/revert the code to the previous known-good commit
# restore DB only if a schema/data rollback is actually necessary
docker compose build
docker compose up -d
```

Schema additions are backward-compatible (new tables/columns); normally a code rollback does not require deleting them.
Never restore an older DB over newer real payments/bookings without reconciling the data first.

## 9. What is intentionally not auto-tested by the patch

The local integration test does not make real Telegram or YCLIENTS network calls. Those credentials and external side effects belong only in the production smoke test above. All local finance tests are network-free.
