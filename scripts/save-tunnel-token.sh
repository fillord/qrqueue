#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

printf 'Paste the Cloudflare Docker command or tunnel token (input is hidden): '
IFS= read -r -s input
printf '\n'
token="${input##* }"
if [[ ! "$token" =~ ^eyJ[A-Za-z0-9._=+/-]{97,}$ ]]; then
  echo 'The pasted value does not look like a tunnel token.' >&2
  exit 1
fi

umask 077
printf 'TUNNEL_TOKEN=%s\n' "$token" > .tunnel.env
unset input token
echo 'Saved .tunnel.env (ignored by Git).'
