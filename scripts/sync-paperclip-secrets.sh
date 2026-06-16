#!/usr/bin/env bash
#
# sync-paperclip-secrets.sh — push plugin config (incl. tokens) from 1Password
# into the running Paperclip instance, with NO secret ever touching a terminal
# transcript or chat. Values flow 1Password -> this process -> the Paperclip API.
#
# WHY plain config (not the encrypted secrets vault): Paperclip 2026.609.0 has
# the plugin secret-resolution path disabled ("disabled until company-scoped
# plugin config lands") AND the resolve handler is stubbed. So plugin secrets
# live in plugin config (plaintext at rest in Postgres) until that lands
# upstream. See the plugin manifests for the migration note.
#
# WHAT it does (idempotent):
#   1. delete + reinstall the 3 AgenticOS plugins (refreshes their manifests)
#   2. set github-plugin + openviking-plugin config (token/key + non-secret opts)
#   3. (optional) trigger the pr-triage job to verify end to end
#
# PREREQUISITES
#   - Run from the Mac (where `op` lives) with an SSH tunnel to Paperclip open:
#       ssh -N -L 3100:10.116.16.2:3100 deploy@<droplet>
#   - `op` (1Password CLI) signed in: `op signin`
#   - An instance-admin board API key stored in 1Password. Mint one once:
#       docker compose exec paperclip-server paperclipai token board create \
#         --name secret-sync --never-expires
#     then save the returned `pcp_board_...` value into the AgenticOS Infra item
#     as field `paperclip_board_key`.
#
# CONFIG (override via env):
#   PAPERCLIP_BASE   default http://localhost:3100   (the tunnel)
#   OP_ITEM          default "AgenticOS Infra"
#   OP_VAULT         default "Goldberry Grove - Admin"
# Field names within the item (override if yours differ):
#   OP_FIELD_BOARD_KEY   default paperclip_board_key
#   OP_FIELD_GITHUB      default github_token
#   OP_FIELD_OPENVIKING  default openviking_root_api_key
#   TRIGGER_TRIAGE   set to "1" to fire pr-triage at the end
#
set -euo pipefail

PAPERCLIP_BASE="${PAPERCLIP_BASE:-http://localhost:3100}"
OP_ITEM="${OP_ITEM:-AgenticOS Infra}"
OP_VAULT="${OP_VAULT:-Goldberry Grove - Admin}"
OP_FIELD_BOARD_KEY="${OP_FIELD_BOARD_KEY:-paperclip_board_key}"
OP_FIELD_GITHUB="${OP_FIELD_GITHUB:-github_token}"
OP_FIELD_OPENVIKING="${OP_FIELD_OPENVIKING:-openviking_root_api_key}"
GITHUB_ORG="${GITHUB_ORG:-EngineeringMoonBear}"
TRIGGER_TRIAGE="${TRIGGER_TRIAGE:-0}"

command -v op  >/dev/null || { echo "FATAL: 1Password CLI 'op' not found" >&2; exit 1; }
command -v jq  >/dev/null || { echo "FATAL: 'jq' not found" >&2; exit 1; }

op_read() { op read "op://${OP_VAULT}/${OP_ITEM}/$1"; }

echo "==> reading credentials from 1Password (values stay in memory, never printed)"
BOARD_KEY="$(op_read "${OP_FIELD_BOARD_KEY}")"
GITHUB_TOKEN="$(op_read "${OP_FIELD_GITHUB}")"
OPENVIKING_KEY="$(op_read "${OP_FIELD_OPENVIKING}")"
[ -n "${BOARD_KEY}" ]       || { echo "FATAL: board key empty" >&2; exit 1; }
[ -n "${GITHUB_TOKEN}" ]    || { echo "FATAL: github token empty" >&2; exit 1; }
[ -n "${OPENVIKING_KEY}" ]  || { echo "FATAL: openviking key empty" >&2; exit 1; }

AUTH=(-H "Authorization: Bearer ${BOARD_KEY}")
api() { # method path [json-body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" "${AUTH[@]}" -H "Content-Type: application/json" \
      -d "$body" "${PAPERCLIP_BASE}${path}"
  else
    curl -fsS -X "$method" "${AUTH[@]}" "${PAPERCLIP_BASE}${path}"
  fi
}

echo "==> 1/3 refreshing plugins (delete + reinstall to pick up new manifests)"
existing="$(api GET /api/plugins)"
echo "$existing" | jq -r '(.plugins // .)[] | select(.pluginKey|startswith("agenticos.")) | .id' \
  | while read -r id; do
      [ -n "$id" ] && api DELETE "/api/plugins/${id}" >/dev/null && echo "    deleted ${id}"
    done
for name in vault-plugin openviking-plugin github-plugin; do
  status="$(api POST /api/plugins/install \
    "{\"packageName\":\"/paperclip/plugins/${name}\",\"isLocalPath\":true}" \
    | jq -r '.status')"
  echo "    installed ${name} -> ${status}"
done

# Resolve fresh plugin ids by key.
plugins="$(api GET /api/plugins)"
gh_id="$(echo "$plugins" | jq -r '(.plugins // .)[] | select(.pluginKey=="agenticos.github-plugin") | .id')"
ov_id="$(echo "$plugins" | jq -r '(.plugins // .)[] | select(.pluginKey=="agenticos.openviking-plugin") | .id')"

echo "==> 2/3 setting plugin config (token values supplied inline by jq, not echoed)"
gh_cfg="$(jq -nc --arg t "$GITHUB_TOKEN" --arg org "$GITHUB_ORG" \
  '{configJson:{githubToken:$t, org:$org, staleDays:7, vaultPath:"wiki/_meta/dev-pr-digest.md", vaultServerUrl:"http://vault-server:7777"}}')"
api POST "/api/plugins/${gh_id}/config" "$gh_cfg" >/dev/null && echo "    github-plugin config set"

ov_cfg="$(jq -nc --arg k "$OPENVIKING_KEY" \
  '{configJson:{apiKey:$k, endpoint:"http://openviking:1933", account:"agenticos", user:"deploy"}}')"
api POST "/api/plugins/${ov_id}/config" "$ov_cfg" >/dev/null && echo "    openviking-plugin config set"

if [ "${TRIGGER_TRIAGE}" = "1" ]; then
  echo "==> 3/3 triggering pr-triage"
  job_id="$(api GET "/api/plugins/${gh_id}/jobs" | jq -r '(.jobs // .)[] | select(.jobKey=="pr-triage") | .id' | head -1)"
  if [ -n "$job_id" ]; then
    api POST "/api/plugins/${gh_id}/jobs/${job_id}/trigger" '{}' >/dev/null && echo "    pr-triage triggered"
  else
    echo "    WARN: could not resolve pr-triage job id; trigger it from the UI"
  fi
else
  echo "==> 3/3 skipped trigger (set TRIGGER_TRIAGE=1 to fire pr-triage)"
fi

echo "==> done. Plugins refreshed + configured from 1Password."
