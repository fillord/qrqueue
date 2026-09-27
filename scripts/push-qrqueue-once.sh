#!/usr/bin/env bash
# Push this repository without storing a GitHub token in Git or the credential helper.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(git remote get-url origin)" != 'https://github.com/fillord/qrqueue.git' ]]; then
  echo 'Unexpected GitHub repository; refusing to push.' >&2
  exit 1
fi
if [[ "$(git branch --show-current)" != 'main' ]]; then
  echo 'Switch to the main branch before pushing.' >&2
  exit 1
fi

git -c credential.helper= push https://fillord@github.com/fillord/qrqueue.git main
local_head="$(git rev-parse HEAD)"
remote_head="$(git ls-remote origin refs/heads/main | awk '{print $1}')"
if [[ "$local_head" != "$remote_head" ]]; then
  echo 'Push returned, but the GitHub branch does not match the local commit.' >&2
  exit 1
fi
printf 'GitHub main matches local commit %s\n' "$local_head"
