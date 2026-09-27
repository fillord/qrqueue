#!/usr/bin/env bash
# Create a verified backup on Oracle and copy that exact file to this Mac.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
: "${QRQUEUE_ORACLE_SSH_TARGET:?Set QRQUEUE_ORACLE_SSH_TARGET (for example ubuntu@server-ip)}"
: "${QRQUEUE_ORACLE_SSH_KEY:?Set QRQUEUE_ORACLE_SSH_KEY to the private SSH key path}"

ssh_args=(-i "$QRQUEUE_ORACLE_SSH_KEY" -o BatchMode=yes)
result="$(ssh "${ssh_args[@]}" "$QRQUEUE_ORACLE_SSH_TARGET" 'cd ~/qrqueue && sudo QUEUE_DEPLOYMENT=oracle bash scripts/backup-verified.sh')"
expected_hash="$(printf '%s\n' "$result" | awk 'NR == 1 {print $1}')"
remote_path="$(printf '%s\n' "$result" | sed -n 's/^Verified database backup: //p' | tail -n 1)"
if [[ ! "$expected_hash" =~ ^[0-9a-f]{64}$ || ! "$remote_path" =~ ^backups/queue-verified-[0-9]{8}-[0-9]{6}\.dump$ ]]; then
  echo 'Oracle backup did not return a verifiable file.' >&2
  exit 1
fi

mkdir -p backups
local_path="backups/oracle-${remote_path##*/}"
partial="$(mktemp "${local_path}.partial.XXXXXX")"
trap 'rm -f "$partial"' EXIT
ssh "${ssh_args[@]}" "$QRQUEUE_ORACLE_SSH_TARGET" "cd ~/qrqueue && sudo cat '$remote_path'" > "$partial"
test -s "$partial"
actual_hash="$(shasum -a 256 "$partial" | awk '{print $1}')"
if [[ "$actual_hash" != "$expected_hash" ]]; then
  echo 'Oracle backup checksum mismatch.' >&2
  exit 1
fi
mv "$partial" "$local_path"
printf 'Verified Oracle backup: %s (%s bytes)\n' "$local_path" "$(wc -c < "$local_path" | tr -d ' ')"
