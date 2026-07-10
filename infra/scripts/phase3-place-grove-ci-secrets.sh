#!/usr/bin/env bash
# phase3-place-grove-ci-secrets.sh (ADR-0001 Phase 3.1)
#
# Populates the per-stage CI vaults (Grove Prod / Grove QA) from existing
# 1Password sources. Reads each SOURCE ref and upserts it as a FIELD (label =
# the GitHub-Actions env-var name) on the per-repo ITEM in the STAGE vault:
#     op://<STAGE vault>/<ITEM>/<FIELD>
#
# Source of truth for the inventory: the "Grove Secrets Inventory" vault note.
#
# USAGE
#   1. Fill the SOURCE column in MAP below (the op:// ref where each secret
#      lives today). Rows left as FILL_SOURCE_REF are reported and skipped;
#      set a row to SKIP to ignore it intentionally.
#   2. Sign in: op account get   (must succeed)
#   3. Dry run:  ./phase3-place-grove-ci-secrets.sh --dry-run
#   4. Apply:    ./phase3-place-grove-ci-secrets.sh
#
# Idempotent: re-running updates fields in place. Never prints secret values.
set -euo pipefail

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# SOURCE_REF | STAGE_VAULT | ITEM | FIELD(env-var name)
# ── odoocker ──────────────────────────────────────────────────────────────
MAP=$(cat <<'ROWS'
op://Goldberry Grove - Admin/Grove Infra/do_token_scoped | Grove Prod | odoocker | DIGITALOCEAN_TOKEN
FILL_SOURCE_REF | Grove Prod | odoocker | DO_SPACES_ACCESS_KEY
FILL_SOURCE_REF | Grove Prod | odoocker | DO_SPACES_SECRET_KEY
FILL_SOURCE_REF | Grove Prod | odoocker | DO_SSH_KEY_ID
FILL_SOURCE_REF | Grove Prod | odoocker | PROD_HOST
FILL_SOURCE_REF | Grove Prod | odoocker | PROD_SSH_PRIVATE_KEY
FILL_SOURCE_REF | Grove Prod | odoocker | SLACK_WEBHOOK_URL
FILL_SOURCE_REF | Grove Prod | odoocker | DISCORD_OPS_WEBHOOK_URL
FILL_SOURCE_REF | Grove QA   | odoocker | SANDBOX_SSH_PRIVATE_KEY
FILL_SOURCE_REF | Grove QA   | odoocker | ENV_SANDBOX
ROWS
)
# ── grove-sites (P3.3 — fill when you get there; harmless to place now) ─────
MAP_GROVE_SITES=$(cat <<'ROWS'
FILL_SOURCE_REF | Grove Prod | grove-sites | DIGITALOCEAN_TOKEN
FILL_SOURCE_REF | Grove Prod | grove-sites | DO_SPACES_ACCESS_KEY
FILL_SOURCE_REF | Grove Prod | grove-sites | DO_SPACES_SECRET_KEY
FILL_SOURCE_REF | Grove Prod | grove-sites | ADMIN_IP_CIDR
FILL_SOURCE_REF | Grove Prod | grove-sites | GHOST_KEY_GOLDBERRY
FILL_SOURCE_REF | Grove Prod | grove-sites | GHOST_KEY_GGG
FILL_SOURCE_REF | Grove Prod | grove-sites | GHOST_KEY_NURSERY
FILL_SOURCE_REF | Grove Prod | grove-sites | DISCORD_OPS_WEBHOOK_URL
FILL_SOURCE_REF | Grove QA   | grove-sites | PREVIEW_SSH_KEY_ID
ROWS
)

command -v op >/dev/null || { echo "op CLI not found" >&2; exit 1; }
op account get >/dev/null 2>&1 || { echo "not signed in to 1Password (op signin)" >&2; exit 1; }

placed=0 skipped=0 failed=0
place_row() {
  local src="$1" vault="$2" item="$3" field="$4"
  case "$src" in
    ""|FILL_SOURCE_REF) echo "  skip   $vault / $item / $field  (source not filled)"; skipped=$((skipped+1)); return;;
    SKIP)               echo "  skip   $vault / $item / $field  (SKIP)";               skipped=$((skipped+1)); return;;
  esac
  local val
  if ! val=$(op read "$src" 2>/dev/null); then
    echo "  FAIL   $vault / $item / $field  (can't read source: $src)" >&2; failed=$((failed+1)); return
  fi
  if [ "$DRY" = 1 ]; then echo "  would  $vault / $item / $field  (len=${#val})"; placed=$((placed+1)); return; fi
  # upsert: edit adds/updates the field on an existing item; create makes it the first time.
  if op item edit "$item" --vault "$vault" "$field[password]=$val" >/dev/null 2>&1; then
    echo "  ok     $vault / $item / $field  (updated)"
  else
    op item create --category "API Credential" --title "$item" --vault "$vault" "$field[password]=$val" >/dev/null
    echo "  ok     $vault / $item / $field  (created item)"
  fi
  placed=$((placed+1))
}

process() {
  while IFS='|' read -r src vault item field; do
    src=$(echo "${src:-}" | xargs); vault=$(echo "${vault:-}" | xargs)
    item=$(echo "${item:-}" | xargs); field=$(echo "${field:-}" | xargs)
    [ -z "$field" ] && continue
    place_row "$src" "$vault" "$item" "$field"
  done <<< "$1"
}

echo "== odoocker =="
process "$MAP"
echo "== grove-sites =="
process "$MAP_GROVE_SITES"
echo
echo "placed=$placed skipped=$skipped failed=$failed${DRY:+ (dry-run)}"
[ "$failed" -eq 0 ]
