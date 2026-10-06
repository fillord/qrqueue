#!/usr/bin/env bash
# Rebuild and validate the exact local tree before it may be released.
set -euo pipefail
cd "$(dirname "$0")/.."
release="${APP_VERSION:-$(git rev-parse HEAD)}"
export APP_VERSION="$release"

db_was_running="$(docker compose ps --status running -q db)"
redis_was_running="$(docker compose ps --status running -q redis)"
cleanup() {
  if [[ -z "$db_was_running" ]]; then docker compose stop db >/dev/null 2>&1 || true; fi
  if [[ -z "$redis_was_running" ]]; then docker compose stop redis >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

python3 scripts/test-deploy-safety.py
npm --prefix frontend ci
npm --prefix frontend test -- --run
npm --prefix frontend run build

docker compose up -d db redis
docker compose build backend frontend
docker compose run --rm backend python scripts/test.py -q

echo "Release checks passed for $release"
