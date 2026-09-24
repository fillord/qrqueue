#!/usr/bin/env bash
# Restore a fresh local dump into a uniquely named disposable database.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T db sh -s <<'INNER'
set -eu
verify_db="queue_restore_check_$(date +%s)_$$"
verify_dump="$(mktemp /tmp/queue-backup-check.XXXXXX)"
cleanup() {
  dropdb -U "$POSTGRES_USER" --if-exists "$verify_db"
  rm -f "$verify_dump"
}
trap cleanup EXIT INT TERM
pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --file="$verify_dump"
createdb -U "$POSTGRES_USER" "$verify_db"
pg_restore -U "$POSTGRES_USER" --dbname="$verify_db" --exit-on-error "$verify_dump"
psql -U "$POSTGRES_USER" -d "$verify_db" -v ON_ERROR_STOP=1 -c 'SELECT version_num FROM alembic_version; SELECT count(*) AS restored_organizations FROM organizations; SELECT count(*) AS restored_tickets FROM tickets; SELECT count(*) AS restored_trial_requests FROM trial_requests;'
echo 'Backup restore verified; disposable database will be removed.'
INNER
