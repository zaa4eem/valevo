#!/bin/sh
set -e

# The uploads volume (zaa4eem-api-uploads) may already exist from a previous
# deploy that ran as root, or be freshly created by Docker and owned by
# root by default — either way, make sure the unprivileged `node` user can
# write to it before dropping to that user. Cheap no-op once ownership is
# already correct, so this is safe to run on every container start.
chown -R node:node /repo/apps/api/uploads

exec gosu node "$@"
