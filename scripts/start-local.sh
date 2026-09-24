#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  echo 'Create .env from .env.example and set the required values first.' >&2
  exit 1
fi
docker network inspect web >/dev/null 2>&1 || docker network create web
docker compose build backend frontend
docker compose up -d db redis
docker compose run --rm --no-deps backend alembic upgrade head
docker compose up -d backend frontend
docker compose ps
