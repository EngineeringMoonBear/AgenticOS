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
# The agenticos-broker-ro service-account token is stored as an `ops_...` FIELD on
# the AgenticOS Infra item (not a standalone item). The detector below scans by
# value prefix, so it finds it whatever the field is labeled. Override if it moves.
ITEM="${BROKER_TOKEN_ITEM:-AgenticOS Infra}"

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

# Fetch the item once, then select the token. An item can hold MORE THAN ONE
# ops_ token (e.g. AgenticOS Infra carries both the Production-Terraform key AND
# the broker key), so we must NOT just grab the first ops_ value — that could run
# the broker under a broader-scoped identity. Selection order:
#   1) field whose label == BROKER_TOKEN_FIELD (default agenticos-broker-ro_token)
#   2) field whose label contains "broker-ro"
#   3) the ONLY ops_ field, if exactly one
#   4) otherwise refuse and list the candidates (ambiguous — set BROKER_TOKEN_FIELD)
# Override source item/vault with BROKER_TOKEN_ITEM / AGENTICOS_OP_VAULT.
item_json="$(op item get "$ITEM" --vault "$VAULT" --reveal --format json 2>/dev/null || true)"
if [ -z "$item_json" ]; then
    echo "✗ Could not read item '$ITEM' in vault '$VAULT'. Does it exist? Is op authed to that vault?" >&2
    echo "  List items:  op item list --vault '$VAULT'" >&2
    exit 1
fi

token="$(printf '%s' "$item_json" | BROKER_TOKEN_FIELD="${BROKER_TOKEN_FIELD:-agenticos-broker-ro_token}" python3 -c '
import json, os, sys
d = json.load(sys.stdin)
want = os.environ["BROKER_TOKEN_FIELD"].lower()
fields = d.get("fields", [])
def val(f): return f.get("value") or ""
ops = [f for f in fields if val(f).startswith("ops_")]
def emit(f, why):
    sys.stderr.write("→ read token from field %r (%s)\n" % (f.get("label"), why)); print(val(f)); sys.exit(0)
for f in ops:
    if (f.get("label") or "").lower() == want: emit(f, "exact label")
for f in ops:
    if "broker-ro" in (f.get("label") or "").lower(): emit(f, "broker-ro label")
if len(ops) == 1: emit(ops[0], "only ops_ field")
if len(ops) > 1:
    sys.stderr.write("✗ %d ops_ tokens in this item — ambiguous. Set BROKER_TOKEN_FIELD to the right label:\n" % len(ops))
    for f in ops: sys.stderr.write("    - %r\n" % f.get("label"))
' || true)"

if [ -z "$token" ]; then
    # Distinguish "no ops_ at all" from the ambiguous case (which printed above).
    if ! printf '%s' "$item_json" | grep -q '"ops_'; then
        echo "✗ No ops_ service-account token found in item '$ITEM' (vault '$VAULT')." >&2
        echo "  Fields present (label = 4-char value preview):" >&2
        printf '%s' "$item_json" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for f in d.get("fields", []):
    v = f.get("value") or ""
    print("    - %-24r %s" % (f.get("label"), (v[:4]+"…") if v else "(empty)"), file=sys.stderr)
' >&2
        echo "  → If NO field shows ops_…, the token was never saved (shown once at creation)." >&2
        echo "    Regenerate: Developer → Service Accounts → agenticos-broker-ro → new token." >&2
    fi
    exit 1
fi

export OP_SERVICE_ACCOUNT_TOKEN="$token"
export BROKER_API_KEY="${BROKER_API_KEY:-dev-local-key}"
export SECRETS_MAP_FILE="${SECRETS_MAP_FILE:-./secrets-map.json}"

# Never print the token value — only its shape, so a bad field is obvious.
printf '✓ token ok (len=%s prefix=%s) — starting broker on :%s\n' \
    "${#OP_SERVICE_ACCOUNT_TOKEN}" "${OP_SERVICE_ACCOUNT_TOKEN:0:4}" "${PORT:-9100}" >&2

exec node src/main.mjs
