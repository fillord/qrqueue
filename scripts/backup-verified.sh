#!/usr/bin/env bash
# Create one consistent database dump and verify that very file restores.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p backups
output="${1:-backups/queue-verified-$(date +%Y%m%d-%H%M%S).dump}"
compose=(docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.tunnel.yml)
tmp="${output}.partial"
verify_db="queue_restore_check_$(date +%s)_$$"
cleanup() {
  "${compose[@]}" exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$1"' sh "$verify_db" >/dev/null 2>&1 || true
  rm -f "$tmp"
}
trap cleanup EXIT
"${compose[@]}" exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$tmp"
test -s "$tmp"
"${compose[@]}" exec -T db sh -c 'createdb -U "$POSTGRES_USER" "$1"' sh "$verify_db"
"${compose[@]}" exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error' sh "$verify_db" < "$tmp"
"${compose[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$1" -Atqc "SELECT count(*) FROM alembic_version"' sh "$verify_db" | grep -qx 1
mv "$tmp" "$output"
shasum -a 256 "$output"
echo "Verified database backup: $output"
