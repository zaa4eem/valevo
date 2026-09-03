# Postgres backups

`infra/backup.sh` dumps the database via `docker compose exec postgres
pg_dump`, gzips it into `infra/backups/`, and deletes anything older than
`KEEP_DAYS` (default 14). Run it from the VPS host, not inside a container.

## One-off backup

```bash
cd valevo/zaa4eem-site
./infra/backup.sh
```

Writes `infra/backups/zaa4eem-<timestamp>.sql.gz`.

## Automate it with cron

Daily at 03:00 server time, keeping 14 days:

```bash
crontab -e
```

Add:

```cron
0 3 * * * cd /path/to/valevo/zaa4eem-site && ./infra/backup.sh >> infra/backups/backup.log 2>&1
```

Override defaults by exporting env vars before the script runs (or setting
them in the crontab line): `BACKUP_DIR`, `KEEP_DAYS`, `COMPOSE_FILE`,
`ENV_FILE`.

Backups are local to the VPS disk — for real disaster recovery (the VPS
itself dying), also sync `infra/backups/` somewhere off-box on a schedule
(e.g. `rclone`/`rsync` to another host or S3-compatible storage). Not set
up automatically here since it needs credentials for wherever you choose.

## Restoring from a dump

```bash
cd valevo/zaa4eem-site
gunzip -c infra/backups/zaa4eem-<timestamp>.sql.gz | \
  docker compose -f infra/docker-compose.yml --env-file infra/.env exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

This restores into the **existing** database — it doesn't drop anything
first, so restoring into a database that already has data will produce
conflict errors on tables/rows that already exist. For a full restore onto
a fresh instance (new VPS, or recovering from total data loss), start the
stack, let migrations create an empty schema, then either truncate every
table before running the command above or restore into the empty database
before ever pointing traffic at it.
