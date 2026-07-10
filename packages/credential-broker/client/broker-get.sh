#!/usr/bin/env bash
# broker-get.sh — fetch one allowlisted secret from the credential broker.
#
# The consumer-side counterpart to the broker: a terraform wrapper, agent, or CI
# step asks the broker for a named secret over the compose network and never sees
# the backing 1Password service-account token.
#
# Usage:
#   BROKER_URL=http://credential-broker:9100 \
#   BROKER_API_KEY=... \
#     broker-get.sh do_token_scoped
#
# Prints ONLY the secret value on stdout (so it composes: TF_VAR_x="$(broker-get.sh x)").
# Never echoes the value in diagnostics — errors go to stderr.

set -euo pipefail

name="${1:?usage: broker-get.sh <secret-name>}"
url="${BROKER_URL:?BROKER_URL is required}"
key="${BROKER_API_KEY:?BROKER_API_KEY is required}"

resp="$(curl -sS -w $'\n%{http_code}' \
    -H "Authorization: Bearer ${key}" \
    "${url}/secret/${name}")"
code="${resp##*$'\n'}"
body="${resp%$'\n'*}"

if [ "$code" != "200" ]; then
    # Print the error field, never the (absent) value.
    echo "broker-get: '$name' failed (HTTP $code): $(echo "$body" | tr -d '[:cntrl:]')" >&2
    exit 1
fi

# Extract .value. jq is correct (handles any escaping); the sed fallback is
# portable (BSD + GNU) and safe for token-shaped values (no embedded '"').
if command -v jq >/dev/null 2>&1; then
    printf '%s' "$body" | jq -r '.value'
else
    printf '%s' "$body" | sed -e 's/.*"value":"//' -e 's/".*//'
fi
