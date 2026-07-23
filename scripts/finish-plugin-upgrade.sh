#!/usr/bin/env bash
#
# finish-plugin-upgrade.sh — GOL-733 (follow-up to GOL-717 / GOL-727)
#
# Finish a manifest-version bump for one or more AgenticOS plugins by converging
# the STORED plugin-registry version with the freshly-deployed dist. Run ON the
# droplet by deploy-droplet-plugins.yml AFTER the dists are rebuilt, for each
# plugin whose src/manifest.ts changed (scripts/detect-manifest-bumps.sh).
#
# Why this exists: the deploy hot-reloads worker CODE, but the stored manifest
# version stays pinned to the old value, so the registry + a fresh install seed
# the OLD code path even though main and dist/ are already new (cost 2 full
# investigations: GOL-717, GOL-727). POST /api/plugins/<id>/upgrade is the
# idempotent, zero-downtime finish (safe from `ready`) that bumps the registry
# version AND reloads the worker. This script automates it in CD.
#
# Credentials: the board key is read on the box from 1Password via the
# credential-broker OP service-account token (GOL-313 pattern) — NEVER a GitHub
# Actions secret (no CI secrets:write on this repo; App token = read-only).
#
# Usage: scripts/finish-plugin-upgrade.sh <plugin> [<plugin> ...]
#   plugin ∈ vault-plugin | openviking-plugin | github-plugin | github-sync-plugin
#
# Env overrides:
#   COMPOSE_DIR    default /opt/agenticos      (docker compose project dir)
#   REPO_DIR       default /opt/agenticos/repo (deployed checkout with dist/)
#   BROKER_ENV     default $COMPOSE_DIR/secrets/credential-broker.env
#   BOARD_KEY_REF  default op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key
#   OP_IMG         default 1password/op:2
#   PAPERCLIP_BASE override the API origin (default: derived from `docker compose port`)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/agenticos}"
REPO_DIR="${REPO_DIR:-/opt/agenticos/repo}"
BROKER_ENV="${BROKER_ENV:-${COMPOSE_DIR}/secrets/credential-broker.env}"
BOARD_KEY_REF="${BOARD_KEY_REF:-op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key}"
OP_IMG="${OP_IMG:-1password/op:2}"
VALID="vault-plugin openviking-plugin github-plugin github-sync-plugin"

# --- validate args BEFORE touching op/docker so bad input fails fast ----------
[ "$#" -ge 1 ] || { echo "usage: $0 <plugin> [<plugin> ...]" >&2; exit 2; }
for p in "$@"; do
  case " ${VALID} " in
    *" ${p} "*) ;;
    *) echo "FATAL: unknown plugin '${p}' (valid: ${VALID})" >&2; exit 2 ;;
  esac
done
command -v node   >/dev/null || { echo "FATAL: node not found on PATH" >&2; exit 1; }
command -v docker >/dev/null || { echo "FATAL: docker not found" >&2; exit 1; }

# --- API origin: the VPC-bound host port for paperclip-server:3100 ------------
# Derived (never hard-coded) from compose so it tracks the bind in
# docker-compose.yml (currently 10.116.16.2:3100).
if [ -z "${PAPERCLIP_BASE:-}" ]; then
  hostport="$(cd "$COMPOSE_DIR" && docker compose port paperclip-server 3100 2>/dev/null | tail -n1 || true)"
  [ -n "$hostport" ] || {
    echo "FATAL: could not resolve paperclip-server:3100 host port (is the container up?)" >&2
    exit 1
  }
  PAPERCLIP_BASE="http://${hostport}"
fi

# --- board key from 1Password via the on-box credential-broker OP token -------
# The box has no op CLI; read via a pinned op container (GOL-313 pattern).
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

echo "paperclip API: ${PAPERCLIP_BASE}"

rc=0
for p in "$@"; do
  key="agenticos.${p}"
  mf="${REPO_DIR}/packages/${p}/dist/manifest.js"
  want=""
  if [ -s "$mf" ]; then
    # Format-agnostic: read the version string straight out of the built dist.
    want="$(grep -oE 'version:[[:space:]]*"[^"]+"' "$mf" | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
  fi
  echo "== ${p}: /upgrade → converge registry to ${want:-<unknown>} =="
  if PLUGIN_KEY="$key" WANT_VERSION="$want" node "${HERE}/finish-plugin-upgrade.mjs"; then
    echo "   ${p}: converged"
  else
    echo "::error title=Plugin upgrade failed::${p}: the registry did not converge to ${want:-the deployed version} via /upgrade — the running worker may still serve the previous code path. Finish manually per docs/runbooks/deploy-plugin-manifest-change.md"
    rc=1
  fi
done
exit $rc
