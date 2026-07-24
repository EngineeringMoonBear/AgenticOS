#!/usr/bin/env bash
#
# plugin-api-env.sh — GOL-804 (extracted from finish-plugin-upgrade.sh)
#
# Resolve the two things any on-droplet plugin-API script needs and export them:
#   PAPERCLIP_BASE  — the VPC-bound host origin for paperclip-server:3100,
#                     derived from `docker compose port` (never hard-coded).
#   BOARD_KEY       — the board bearer key, read on the box from 1Password via a
#                     pinned op container using the credential-broker OP service-
#                     account token (GOL-313 pattern; no op CLI on the box, no
#                     GitHub Actions secret — this repo has no CI secrets:write).
#
# Source it (do NOT execute): `source "${HERE}/plugin-api-env.sh"`. Keeping this
# in one place means finish-plugin-upgrade.sh and assert-plugin-versions.sh can
# never disagree on how they reach or authenticate to the board API.
#
# Env overrides:
#   COMPOSE_DIR    default /opt/agenticos
#   BROKER_ENV     default $COMPOSE_DIR/secrets/credential-broker.env
#   BOARD_KEY_REF  default op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key
#   OP_IMG         default 1password/op:2
#   PAPERCLIP_BASE preset to skip the docker-compose port derivation

COMPOSE_DIR="${COMPOSE_DIR:-/opt/agenticos}"
BROKER_ENV="${BROKER_ENV:-${COMPOSE_DIR}/secrets/credential-broker.env}"
BOARD_KEY_REF="${BOARD_KEY_REF:-op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key}"
OP_IMG="${OP_IMG:-1password/op:2}"

command -v docker >/dev/null || { echo "FATAL: docker not found" >&2; exit 1; }

# --- API origin: the VPC-bound host port for paperclip-server:3100 ------------
if [ -z "${PAPERCLIP_BASE:-}" ]; then
  hostport="$(cd "$COMPOSE_DIR" && docker compose port paperclip-server 3100 2>/dev/null | tail -n1 || true)"
  [ -n "$hostport" ] || {
    echo "FATAL: could not resolve paperclip-server:3100 host port (is the container up?)" >&2
    exit 1
  }
  PAPERCLIP_BASE="http://${hostport}"
fi

# --- board key from 1Password via the on-box credential-broker OP token -------
[ -f "$BROKER_ENV" ] || {
  echo "FATAL: $BROKER_ENV absent — the credential-broker OP service-account token is not provisioned, so the board key cannot be read. Finish manually per docs/runbooks/deploy-plugin-manifest-change.md" >&2
  exit 1
}
OP_TOKEN="$(grep -E '^OP_SERVICE_ACCOUNT_TOKEN=' "$BROKER_ENV" | head -n1 | cut -d= -f2-)"
OP_TOKEN="${OP_TOKEN%\"}"; OP_TOKEN="${OP_TOKEN#\"}"
OP_TOKEN="${OP_TOKEN%\'}"; OP_TOKEN="${OP_TOKEN#\'}"
[ -n "${OP_TOKEN:-}" ] || { echo "FATAL: OP_SERVICE_ACCOUNT_TOKEN empty in $BROKER_ENV" >&2; exit 1; }
BOARD_KEY="$(docker run --rm --entrypoint op -e OP_SERVICE_ACCOUNT_TOKEN="$OP_TOKEN" "$OP_IMG" read "$BOARD_KEY_REF" 2>/dev/null || true)"
[ -n "$BOARD_KEY" ] || { echo "FATAL: board key did not resolve from 1Password ($BOARD_KEY_REF)" >&2; exit 1; }
export BOARD_KEY PAPERCLIP_BASE
