#!/usr/bin/env bash
set -euo pipefail

label="site.omni-book.qrqueue-tunnel-watchdog"
agent_dir="${HOME}/Library/LaunchAgents"
agent_file="$agent_dir/$label.plist"
log_dir="${HOME}/Library/Logs"
watch_dir="${HOME}/Library/Application Support/qrqueue-tunnel-watchdog"
watch_script="$watch_dir/watch-tunnel.sh"
mkdir -p "$agent_dir" "$log_dir" "$watch_dir"
cp "$(dirname "$0")/watch-tunnel.sh" "$watch_script"
chmod 700 "$watch_script"

python3 - "$agent_file" "$label" "$watch_script" "$log_dir/qrqueue-tunnel-watchdog.log" "$(command -v docker)" <<'PY'
import plistlib
import sys

target, label, script, log, docker = sys.argv[1:]
with open(target, 'wb') as file:
    plistlib.dump({
        'Label': label,
        'ProgramArguments': ['/bin/bash', script],
        'EnvironmentVariables': {'QRQUEUE_DOCKER_BIN': docker},
        'RunAtLoad': True,
        'StartInterval': 60,
        'StandardOutPath': log,
        'StandardErrorPath': log,
    }, file)
PY

launchctl bootout "gui/$(id -u)" "$agent_file" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$agent_file"
echo "Installed tunnel watchdog: $agent_file"
