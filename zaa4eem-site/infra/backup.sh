#!/usr/bin/env bash
# Dumps the ZAA4EEM Postgres database to a gzipped file and deletes backups
# older than KEEP_DAYS. Meant to run on the VPS host (not inside a
# container) via cron — see infra/BACKUPS.md for the cron line and how to
# restore from a dump.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy infra/.env.example to infra/.env and fill it in first." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

# A dump contains every user's password hash and email — the directory
# and each file it holds must not be world/group-readable regardless of
# the host's umask.
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="$BACKUP_DIR/zaa4eem-${TIMESTAMP}.sql.gz"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$DUMP_FILE"
chmod 600 "$DUMP_FILE"

# Optional at-rest encryption — set BACKUP_ENCRYPTION_PASSPHRASE in infra/.env
# to enable it. Off by default so an existing setup keeps working unchanged;
# on by simply setting the passphrase, no other flags needed.
if [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  OUT_FILE="${DUMP_FILE}.gpg"
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
    --symmetric --cipher-algo AES256 -o "$OUT_FILE" "$DUMP_FILE"
  chmod 600 "$OUT_FILE"
  rm -f "$DUMP_FILE"
else
  OUT_FILE="$DUMP_FILE"
fi

echo "Backup written to $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

DELETED=$(find "$BACKUP_DIR" -name 'zaa4eem-*.sql.gz*' -mtime "+${KEEP_DAYS}" -print -delete)
if [ -n "$DELETED" ]; then
  echo "Rotated out backups older than ${KEEP_DAYS}d:"
  echo "$DELETED"
fi
