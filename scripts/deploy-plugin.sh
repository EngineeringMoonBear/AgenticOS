#!/usr/bin/env bash
#
# deploy-plugin.sh — finish a manifest-change deploy for one or more AgenticOS
# plugins. Run from the Mac, exactly like sync-paperclip-secrets.sh:
#   - `op` signed in (`op signin`)
#   - SSH tunnel to Paperclip open:
#       ssh -fNL 3100:10.116.16.2:3100 deploy@<droplet>
# Idempotent: safe to re-run.
#
# Per plugin:
#   1. recreate-guard — force-recreate paperclip-server ONLY if the plugin dir
#      isn't visible in the container yet (a newly-added bind mount)
#   2. delete + reinstall — refreshes the stored manifest (install won't update)
#   3. apply config from 1Password — github/openviking only; vault has none;
#      github-sync is configured via its own runbook
#   4. disable -> enable — forces the worker setup() to re-run with fresh config
#   5. assert — plugin present and not in an error state
#
# Usage: scripts/deploy-plugin.sh <plugin> [<plugin> ...]
#   plugin ∈ vault-plugin | openviking-plugin | github-plugin | github-sync-plugin
#
# Env: as paperclip-lib.sh, plus:
#   DROPLET_SSH   default "deploy@agenticos-droplet"  (recreate-guard SSH target)
#   COMPOSE_DIR   default "/opt/agenticos"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/paperclip-lib.sh
source "${HERE}/paperclip-lib.sh"

DROPLET_SSH="${DROPLET_SSH:-deploy@agenticos-droplet}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/agenticos}"
VALID_PLUGINS="vault-plugin openviking-plugin github-plugin github-sync-plugin"

usage() {
  echo "Usage: $0 <plugin> [<plugin> ...]" >&2
  echo "  plugin ∈ ${VALID_PLUGINS}" >&2
  exit 2
}

# --- validate args BEFORE touching op/ssh so bad input fails fast & offline ---
[ "$#" -ge 1 ] || usage
for p in "$@"; do
  case " ${VALID_PLUGINS} " in
    *" ${p} "*) ;;
    *) echo "FATAL: unknown plugin '${p}'" >&2; usage ;;
  esac
done

pc_require_tools
command -v ssh >/dev/null || { echo "FATAL: 'ssh' not found" >&2; exit 1; }
pc_load_board_key

# recreate_guard PLUGIN — recreate paperclip-server iff the plugin dir is not
# yet visible in the container. Idempotent (skips when the mount resolves).
recreate_guard() {
  local p="$1"
  if ssh "${DROPLET_SSH}" \
       "cd ${COMPOSE_DIR} && docker compose exec -T paperclip-server test -s /paperclip/plugins/${p}/package.json" \
       >/dev/null 2>&1; then
    echo "    ${p}: mount already resolved (no recreate)"
    return 0
  fi
  echo "    ${p}: mount missing in container -> force-recreate paperclip-server"
  ssh "${DROPLET_SSH}" \
    "cd ${COMPOSE_DIR} && docker compose up -d --force-recreate paperclip-server"
  for _ in $(seq 1 30); do
    if api GET /api/plugins >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "FATAL: ${p}: API did not come back after recreate" >&2
  return 1
}

# reinstall PLUGIN — delete (if present) then install fresh.
reinstall() {
  local p="$1" id status
  id="$(resolve_plugin_id "agenticos.${p}")"
  if [ -n "$id" ]; then
    api DELETE "/api/plugins/${id}" >/dev/null && echo "    ${p}: deleted ${id}"
  fi
  status="$(api POST /api/plugins/install \
    "{\"packageName\":\"/paperclip/plugins/${p}\",\"isLocalPath\":true}" \
    | jq -r '.status')"
  echo "    ${p}: installed -> ${status}"
}

# apply_config PLUGIN — push config from 1Password for plugins that take it.
apply_config() {
  local p="$1"
  case "$p" in
    github-plugin)      configure_github ;;
    openviking-plugin)  configure_openviking ;;
    vault-plugin)       echo "    ${p}: no config" ;;
    github-sync-plugin) echo "    ${p}: config deferred -> see docs/runbooks/github-issue-sync.md" ;;
  esac
}

# cycle PLUGIN — disable then enable to force setup() to re-run.
cycle() {
  local p="$1" id
  id="$(resolve_plugin_id "agenticos.${p}")"
  [ -n "$id" ] || { echo "FATAL: ${p} missing after install" >&2; return 1; }
  api POST "/api/plugins/${id}/disable" >/dev/null 2>&1 || true
  api POST "/api/plugins/${id}/enable"  >/dev/null
  echo "    ${p}: disabled+enabled"
}

# assert_healthy PLUGIN — print status; fail on an error/empty state.
# Healthy = not in an error state. A plugin like github-sync-plugin stays
# inactive by design until separately configured, so we do NOT assert "active".
assert_healthy() {
  local p="$1" status
  status="$(api GET /api/plugins | jq -r --arg k "agenticos.${p}" \
    '(if type=="object" then .plugins else . end)[] | select(.pluginKey==$k) | .status')"
  echo "    ${p}: status=${status}"
  case "$status" in
    error|failed|"") echo "FATAL: ${p} not healthy (status='${status}')" >&2; return 1 ;;
  esac
}

for p in "$@"; do
  echo "==> ${p}"
  recreate_guard "$p"
  reinstall "$p"
  apply_config "$p"
  cycle "$p"
  assert_healthy "$p"
done
echo "==> done. Plugins refreshed from 1Password: $*"
