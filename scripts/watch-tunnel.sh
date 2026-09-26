#!/usr/bin/env bash
set -euo pipefail

docker_cmd="${QRQUEUE_DOCKER_BIN:-docker}"
state_dir="${HOME}/Library/Caches/qrqueue-tunnel-watchdog"
mkdir -p "$state_dir"
chmod 700 "$state_dir"
failures_file="$state_dir/failures"
restart_file="$state_dir/last-restart"

# Docker Desktop may not be ready yet after login or a network change.
if ! "$docker_cmd" info >/dev/null 2>&1; then
  exit 0
fi

public_status="$(/usr/bin/curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://queue.omni-book.site/api/health 2>/dev/null || true)"
if [[ "$public_status" == 200 ]]; then
  printf '0\n' > "$failures_file"
  exit 0
fi

local_status="$(/usr/bin/curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8080/api/health 2>/dev/null || true)"
if [[ "$local_status" != 200 ]]; then
  printf '0\n' > "$failures_file"
  echo "$(date): local app health is $local_status; tunnel restart skipped" >&2
  exit 0
fi

failures="$(cat "$failures_file" 2>/dev/null || true)"
[[ "$failures" =~ ^[0-9]+$ ]] || failures=0
failures=$((failures + 1))
printf '%s\n' "$failures" > "$failures_file"
if (( failures < 2 )); then
  echo "$(date): public health is $public_status; waiting for a second failure" >&2
  exit 0
fi

now="$(date +%s)"
last_restart="$(cat "$restart_file" 2>/dev/null || true)"
[[ "$last_restart" =~ ^[0-9]+$ ]] || last_restart=0
if (( now - last_restart < 300 )); then
  exit 0
fi

printf '%s\n' "$now" > "$restart_file"
printf '0\n' > "$failures_file"
echo "$(date): public health is $public_status; restarting qrqueue cloudflared only" >&2
container_id="$("$docker_cmd" ps --filter 'label=com.docker.compose.project=queue' --filter 'label=com.docker.compose.service=cloudflared' --format '{{.ID}}' | head -n 1)"
if [[ -z "$container_id" ]]; then
  echo "$(date): qrqueue cloudflared container not found" >&2
  exit 0
fi
"$docker_cmd" restart "$container_id" >/dev/null
