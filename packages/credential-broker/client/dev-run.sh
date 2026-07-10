#!/usr/bin/env bash
# dev-run.sh — LOCAL smoke-test helper. Uses the OPERATOR'S interactive `op`
# session to fetch the broker's service-account token from 1Password and launch
# the broker against the REAL machine-identity path.
#
# This is the ONLY place that reads the SA token from 1Password, and it is
# DEV-ONLY. In production the broker CANNOT do this: the token IS its 1Password
# credential, so reading it from 1Password is circular (chicken-and-egg). There
# the token is injected out-of-band via a chmod-600 env file (see README /
# docker-compose). This script exists purely so a human with an interactive `op`
# login can test the real path from their workstation without pasting the token.
#
#   Usage:  BROKER_API_KEY=dev-local-key ./client/dev-run.sh
#   Override the source: AGENTICOS_OP_VAULT / BROKER_TOKEN_ITEM
set -euo pipefail

cd "$(dirname "$0")/.."   # -> package root (src/ + secrets-map.json live here)

VAULT="${AGENTICOS_OP_VAULT:-Goldberry Grove - Admin}"
ITEM="${BROKER_TOKEN_ITEM:-agenticos-broker-ro_token}"

# Bootstrapping needs the operator's INTERACTIVE op session. If OP_SERVICE_ACCOUNT_TOKEN
# is already set in the environment (e.g. a stale/half-pasted value from a prior run),
# `op` forces service-account mode and every op call below fails to parse it
# ("DecodeSACredentials ... format is invalid"). Clear it so we auth interactively;
# we set the real token further down, for node only.
unset OP_SERVICE_ACCOUNT_TOKEN

if ! op account get >/dev/null 2>&1; then
    echo "✗ Not signed in to 1Password. Run: op signin  (then re-run this)." >&2
    exit 1
fi

# Auto-detect the field holding the ops_... token (label varies by how it was
# saved). op read reveals concealed values by default and prints only the value.
token=""
for field in credential password token api_key value; do
    token="$(op read "op://$VAULT/$ITEM/$field" 2>/dev/null || true)"
    if [ -n "$token" ]; then echo "→ read token from field '$field'" >&2; break; fi
done

case "$token" in
    ops_*) : ;;  # looks like a real service-account token
    "")  echo "✗ No token found in item '$ITEM' (vault '$VAULT'); checked fields credential/password/token/api_key/value." >&2
         echo "  Inspect the real labels: op item get '$ITEM' --vault '$VAULT'" >&2
         exit 1 ;;
    *)   echo "✗ Found a field but it isn't a service-account token (want ops_...). Wrong field, or the item holds the SA name/ID instead of the token." >&2
         exit 1 ;;
esac

export OP_SERVICE_ACCOUNT_TOKEN="$token"
export BROKER_API_KEY="${BROKER_API_KEY:-dev-local-key}"
export SECRETS_MAP_FILE="${SECRETS_MAP_FILE:-./secrets-map.json}"

# Never print the token value — only its shape, so a bad field is obvious.
printf '✓ token ok (len=%s prefix=%s) — starting broker on :%s\n' \
    "${#OP_SERVICE_ACCOUNT_TOKEN}" "${OP_SERVICE_ACCOUNT_TOKEN:0:4}" "${PORT:-9100}" >&2

exec node src/main.mjs
