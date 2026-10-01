#!/usr/bin/env bash
# Fail when Oracle has no recent backup that was verified by a restore.
set -euo pipefail
cd "$(dirname "$0")/.."

backup_dir="${1:-backups}"
max_age_hours="${BACKUP_MAX_AGE_HOURS:-30}"
if ! [[ "$max_age_hours" =~ ^[0-9]+$ ]] || (( max_age_hours < 1 )); then
  echo "BACKUP_MAX_AGE_HOURS must be a positive integer." >&2
  exit 2
fi

latest="$(find "$backup_dir" -maxdepth 1 -type f -name 'queue-verified-*.dump' -print 2>/dev/null | sort | tail -n 1)"
if [[ -z "$latest" || ! -s "$latest" ]]; then
  echo "No verified database backup found in $backup_dir." >&2
  exit 1
fi

now_epoch="$(date +%s)"
if stat -c %Y "$latest" >/dev/null 2>&1; then
  modified_epoch="$(stat -c %Y "$latest")"
else
  modified_epoch="$(stat -f %m "$latest")"
fi
age_seconds=$((now_epoch - modified_epoch))
max_age_seconds=$((max_age_hours * 3600))
if (( age_seconds < 0 || age_seconds > max_age_seconds )); then
  echo "Verified backup is stale: $latest ($((age_seconds / 3600)) hours old)." >&2
  exit 1
fi

echo "Verified backup is fresh: $latest ($((age_seconds / 60)) minutes old)."
