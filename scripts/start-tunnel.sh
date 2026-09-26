#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo 'Create .env from .env.example and set the application secrets first.' >&2
  exit 1
fi
if [ ! -f .tunnel.env ] || ! grep -Eq '^TUNNEL_TOKEN=eyJ[A-Za-z0-9._=+/-]{97,}$' .tunnel.env; then
  echo 'Create .tunnel.env from .tunnel.env.example and enter a Cloudflare Tunnel token.' >&2
  exit 1
fi

compose=(docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.tunnel.yml)
"${compose[@]}" build backend frontend
"${compose[@]}" up -d db redis
"${compose[@]}" exec -T db sh -c 'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do sleep 1; done'
mkdir -p backups
umask 077
backup_file="backups/pre-tunnel-$(date +%Y%m%d-%H%M%S).dump"
"${compose[@]}" exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$backup_file"
test -s "$backup_file"
echo "Database backup saved: $backup_file"
"${compose[@]}" run --rm --no-deps backend alembic upgrade head
"${compose[@]}" up -d
"${compose[@]}" ps
