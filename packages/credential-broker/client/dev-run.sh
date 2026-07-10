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

# Fetch the item once, then auto-detect the token by VALUE (not by guessing
# labels): scan every field for a value starting `ops_` (the SA token prefix).
# Override the source with BROKER_TOKEN_ITEM / AGENTICOS_OP_VAULT if the token
# lives elsewhere, e.g.  BROKER_TOKEN_ITEM='AgenticOS Infra' ./client/dev-run.sh
item_json="$(op item get "$ITEM" --vault "$VAULT" --reveal --format json 2>/dev/null || true)"
if [ -z "$item_json" ]; then
    echo "✗ Could not read item '$ITEM' in vault '$VAULT'. Does it exist? Is op authed to that vault?" >&2
    echo "  List items:  op item list --vault '$VAULT'" >&2
    exit 1
fi

token="$(printf '%s' "$item_json" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for f in d.get("fields", []):
    v = f.get("value") or ""
    if v.startswith("ops_"):
        sys.stderr.write("→ read token from field %r\n" % f.get("label"))
        print(v); break
' || true)"

if [ -z "$token" ]; then
    echo "✗ No ops_ service-account token found in item '$ITEM' (vault '$VAULT')." >&2
    echo "  Fields actually present in that item (label = 4-char value preview):" >&2
    printf '%s' "$item_json" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for f in d.get("fields", []):
    v = f.get("value") or ""
    print("    - %-24r %s" % (f.get("label"), (v[:4]+"…") if v else "(empty)"), file=sys.stderr)
' >&2
    echo "  → If the token is on another item: BROKER_TOKEN_ITEM='AgenticOS Infra' ./client/dev-run.sh" >&2
    echo "  → If NO field shows 'ops_…', the item never captured the token (1Password shows it once at" >&2
    echo "    creation). Regenerate: Developer → Service Accounts → agenticos-broker-ro → new token." >&2
    exit 1
fi

export OP_SERVICE_ACCOUNT_TOKEN="$token"
export BROKER_API_KEY="${BROKER_API_KEY:-dev-local-key}"
export SECRETS_MAP_FILE="${SECRETS_MAP_FILE:-./secrets-map.json}"

# Never print the token value — only its shape, so a bad field is obvious.
printf '✓ token ok (len=%s prefix=%s) — starting broker on :%s\n' \
    "${#OP_SERVICE_ACCOUNT_TOKEN}" "${OP_SERVICE_ACCOUNT_TOKEN:0:4}" "${PORT:-9100}" >&2

exec node src/main.mjs
