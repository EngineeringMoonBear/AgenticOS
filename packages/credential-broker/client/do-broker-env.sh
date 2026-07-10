#!/usr/bin/env bash
# do-broker-env.sh — mint a short-lived DO capability token from the broker and
# print the two env exports Terraform needs. The real PAT never enters the shell.
#
# usage: eval "$(BROKER_URL=… BROKER_API_KEY=… ./client/do-broker-env.sh <ro|rw> [ttl-seconds])"
#   emits:  export DIGITALOCEAN_API_URL="$BROKER_URL/do"
#           export DIGITALOCEAN_TOKEN="<minted capability token>"
# ttl-seconds defaults to the broker's DO_PROXY_DEFAULT_TTL_S; the broker clamps
# it to DO_PROXY_MAX_TTL_S.
set -euo pipefail

scope="${1:-ro}"
ttl="${2:-}"
url="${BROKER_URL:?BROKER_URL is required}"
key="${BROKER_API_KEY:?BROKER_API_KEY is required}"

case "$scope" in ro|rw) ;; *) echo "do-broker-env: scope must be ro or rw" >&2; exit 2 ;; esac

q="scope=${scope}"
[ -n "$ttl" ] && q="${q}&ttl=${ttl}"

resp="$(curl -sS -w $'\n%{http_code}' -X POST \
    -H "Authorization: Bearer ${key}" \
    "${url}/token/digitalocean?${q}")"
code="${resp##*$'\n'}"
body="${resp%$'\n'*}"

if [ "$code" != "200" ]; then
    echo "do-broker-env: mint failed (HTTP $code): $(echo "$body" | tr -d '[:cntrl:]')" >&2
    exit 1
fi

# Extract .token (jq if present, else a portable sed; token has no embedded quote).
if command -v jq >/dev/null 2>&1; then
    token="$(printf '%s' "$body" | jq -r '.token')"
else
    token="$(printf '%s' "$body" | sed -e 's/.*"token":"//' -e 's/".*//')"
fi

printf 'export DIGITALOCEAN_API_URL=%q\n' "${url}/do"
printf 'export DIGITALOCEAN_TOKEN=%q\n' "$token"
