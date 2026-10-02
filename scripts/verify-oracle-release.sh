#!/usr/bin/env bash
# Verify source marker, running images, public health and backup freshness.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${QRQUEUE_ORACLE_SSH_TARGET:?Set QRQUEUE_ORACLE_SSH_TARGET}"
: "${QRQUEUE_ORACLE_SSH_KEY:?Set QRQUEUE_ORACLE_SSH_KEY}"
expected="${1:-$(git rev-parse HEAD)}"
if ! [[ "$expected" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected release must be a full Git commit SHA." >&2
  exit 2
fi

ssh_args=(-i "$QRQUEUE_ORACLE_SSH_KEY" -o BatchMode=yes)
remote_result="$(ssh "${ssh_args[@]}" "$QRQUEUE_ORACLE_SSH_TARGET" 'bash -s' -- "$expected" <<'REMOTE'
set -euo pipefail
expected="$1"
cd /home/ubuntu/qrqueue
deployed="$(if [[ -f .deployed-commit ]]; then tr -d '\r\n' < .deployed-commit; fi)"
backend="$(sudo docker inspect queue-backend --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
frontend="$(sudo docker inspect queue-frontend --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
bash scripts/check-backup-freshness.sh
printf 'deployed=%s\nbackend=%s\nfrontend=%s\n' "$deployed" "$backend" "$frontend"
test "$deployed" = "$expected"
test "$backend" = "$expected"
test "$frontend" = "$expected"
REMOTE
)"
printf '%s\n' "$remote_result"

health="$(curl --fail --silent --show-error --max-time 20 \
  --retry 10 --retry-all-errors --retry-delay 2 \
  https://queue.omni-book.site/api/health)"
HEALTH_JSON="$health" EXPECTED_RELEASE="$expected" python3 - <<'PY'
import json
import os

body = json.loads(os.environ["HEALTH_JSON"])
expected = os.environ["EXPECTED_RELEASE"]
if body.get("status") != "ok" or body.get("version") != expected:
    raise SystemExit(f"Unexpected production health: {body!r}")
print(f"Public health matches release {expected}")
PY
