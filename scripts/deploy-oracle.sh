#!/usr/bin/env bash
# Validate, back up and deploy the current main commit to Oracle with rollback.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${QRQUEUE_ORACLE_SSH_TARGET:?Set QRQUEUE_ORACLE_SSH_TARGET}"
: "${QRQUEUE_ORACLE_SSH_KEY:?Set QRQUEUE_ORACLE_SSH_KEY}"

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "Oracle releases must be made from main." >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Tracked files must be committed before deployment." >&2
  exit 1
fi

release="$(git rev-parse HEAD)"
remote_main="$(git ls-remote origin refs/heads/main | awk '{print $1}')"
if [[ "$release" != "$remote_main" ]]; then
  echo "GitHub main does not match local HEAD; refusing to deploy." >&2
  exit 1
fi

if [[ "${SKIP_RELEASE_CHECKS:-false}" != "true" ]]; then
  bash scripts/release-check.sh
fi

QRQUEUE_ORACLE_SSH_TARGET="$QRQUEUE_ORACLE_SSH_TARGET" \
QRQUEUE_ORACLE_SSH_KEY="$QRQUEUE_ORACLE_SSH_KEY" \
  bash scripts/pull-oracle-backup.sh

release_tmp="$(mktemp -d)"
trap 'rm -rf "$release_tmp"' EXIT
archive="$release_tmp/release.tar"
manifest="$release_tmp/manifest"
git archive --format=tar --output="$archive" "$release"
git ls-tree -r --name-only "$release" > "$manifest"

short="${release:0:12}"
remote_archive="/tmp/qrqueue-release-$short.tar"
remote_manifest="/tmp/qrqueue-release-$short.manifest"
ssh_args=(-i "$QRQUEUE_ORACLE_SSH_KEY" -o BatchMode=yes)
scp "${ssh_args[@]}" "$archive" "$QRQUEUE_ORACLE_SSH_TARGET:$remote_archive"
scp "${ssh_args[@]}" "$manifest" "$QRQUEUE_ORACLE_SSH_TARGET:$remote_manifest"

ssh "${ssh_args[@]}" "$QRQUEUE_ORACLE_SSH_TARGET" 'bash -s' -- "$release" "$remote_archive" "$remote_manifest" <<'REMOTE'
set -euo pipefail
release="$1"
archive="$2"
new_manifest="$3"
cd /home/ubuntu/qrqueue

timestamp="$(date +%Y%m%d-%H%M%S)"
source_snapshot="backups/source-before-$timestamp-${release:0:12}.tar.gz"
previous_version="$(sudo docker inspect queue-backend --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | sed -n 's/^APP_VERSION=//p' | head -n 1)"
previous_version="${previous_version:-dev}"
success=false

sudo docker image inspect qrqueue-backend:latest >/dev/null 2>&1 && sudo docker tag qrqueue-backend:latest qrqueue-backend:previous || true
sudo docker image inspect qrqueue-frontend:latest >/dev/null 2>&1 && sudo docker tag qrqueue-frontend:latest qrqueue-frontend:previous || true
snapshot_candidates=(
  backend frontend scripts deploy .github
  docker-compose.yml docker-compose.oracle.yml docker-compose.override.yml docker-compose.tunnel.yml
  README.md ARCHITECTURE.md PROJECT_STATUS.md PROJECT_HANDOFF_2026-10-02.md
  .env.example .tunnel.env.example .gitignore
)
snapshot_paths=()
for snapshot_candidate in "${snapshot_candidates[@]}"; do
  if [[ -e "$snapshot_candidate" ]]; then
    snapshot_paths+=("$snapshot_candidate")
  fi
done
tar \
  --exclude='backend/face_models' --exclude='backend/**/__pycache__' \
  --exclude='frontend/node_modules' --exclude='frontend/dist' \
  -czf "$source_snapshot" \
  "${snapshot_paths[@]}"

rollback() {
  status=$?
  rm -f "$archive" "$new_manifest"
  if [[ "$success" != "true" ]]; then
    echo "Deployment failed; restoring the previous source and images." >&2
    tar -xzf "$source_snapshot"
    if sudo docker image inspect qrqueue-backend:previous >/dev/null 2>&1; then
      sudo docker tag qrqueue-backend:previous qrqueue-backend:latest
    fi
    if sudo docker image inspect qrqueue-frontend:previous >/dev/null 2>&1; then
      sudo docker tag qrqueue-frontend:previous qrqueue-frontend:latest
    fi
    sudo env APP_VERSION="$previous_version" docker compose \
      -f docker-compose.yml -f docker-compose.oracle.yml -f docker-compose.tunnel.yml \
      up -d --force-recreate backend frontend || true
  fi
  exit "$status"
}
trap rollback EXIT

if [[ -f .deploy-manifest ]]; then
  comm -23 <(sort .deploy-manifest) <(sort "$new_manifest") | while IFS= read -r old_file; do
    case "$old_file" in
      backend/*|frontend/*|scripts/*|deploy/*|.github/*|docker-compose*.yml|README.md|ARCHITECTURE.md|PROJECT_STATUS.md|PROJECT_HANDOFF_2026-10-02.md|.env.example|.tunnel.env.example|.gitignore)
        rm -f -- "$old_file"
        ;;
    esac
  done
fi
tar -xf "$archive"

compose=(sudo env "APP_VERSION=$release" docker compose -f docker-compose.yml -f docker-compose.oracle.yml -f docker-compose.tunnel.yml)
"${compose[@]}" build backend frontend
"${compose[@]}" run --rm backend alembic upgrade head
"${compose[@]}" up -d backend frontend

for _ in $(seq 1 30); do
  if health="$(curl -fsS --max-time 5 http://127.0.0.1:8080/api/health 2>/dev/null)"; then
    if HEALTH_JSON="$health" EXPECTED_RELEASE="$release" python3 - <<'PY'
import json
import os
body = json.loads(os.environ["HEALTH_JSON"])
raise SystemExit(0 if body.get("status") == "ok" and body.get("version") == os.environ["EXPECTED_RELEASE"] else 1)
PY
    then
      break
    fi
  fi
  sleep 2
done

health="$(curl -fsS --max-time 5 http://127.0.0.1:8080/api/health)"
HEALTH_JSON="$health" EXPECTED_RELEASE="$release" python3 - <<'PY'
import json
import os
body = json.loads(os.environ["HEALTH_JSON"])
expected = os.environ["EXPECTED_RELEASE"]
if body.get("status") != "ok" or body.get("version") != expected:
    raise SystemExit(f"Local health does not match release: {body!r}")
PY

install -m 0644 "$new_manifest" .deploy-manifest
printf '%s\n' "$release" > .deployed-commit
sudo cp deploy/oracle/qrqueue-backup.service deploy/oracle/qrqueue-backup.timer /etc/systemd/system/
sudo cp deploy/oracle/qrqueue-backup-check.service deploy/oracle/qrqueue-backup-check.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now qrqueue-backup.timer qrqueue-backup-check.timer

success=true
rm -f "$archive" "$new_manifest"
trap - EXIT
echo "Oracle release installed: $release"
REMOTE

QRQUEUE_ORACLE_SSH_TARGET="$QRQUEUE_ORACLE_SSH_TARGET" \
QRQUEUE_ORACLE_SSH_KEY="$QRQUEUE_ORACLE_SSH_KEY" \
  bash scripts/verify-oracle-release.sh "$release"
