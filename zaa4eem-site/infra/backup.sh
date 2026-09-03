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

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/zaa4eem-${TIMESTAMP}.sql.gz"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$OUT_FILE"

echo "Backup written to $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

DELETED=$(find "$BACKUP_DIR" -name 'zaa4eem-*.sql.gz' -mtime "+${KEEP_DAYS}" -print -delete)
if [ -n "$DELETED" ]; then
  echo "Rotated out backups older than ${KEEP_DAYS}d:"
  echo "$DELETED"
fi
