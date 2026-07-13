#!/usr/bin/env bash
# sync-ci-secrets.sh — declarative 1Password → GitHub Actions secret sync (GOL-342)
#
# Reads infra/ci-secrets.yaml (op_ref → repo → SECRET_NAME) and upserts each
# secret with `op read` piped to `gh secret set`. Idempotent: re-running just
# updates in place. Verifies each write via the actions/secrets/<name> metadata
# endpoint. Secret VALUES are never printed, logged, or passed on the command
# line (fed to `gh secret set` on stdin).
#
# USAGE
#   tools/sync-ci-secrets.sh [--dry-run] [--repo owner/name] [--manifest path]
#     --dry-run        resolve + report, write nothing
#     --repo R         only sync entries whose repo == R
#     --manifest P     manifest path (default: infra/ci-secrets.yaml next to tools/)
#
# TOKENS (write-scoped github token, per target repo)
#   Resolution order per repo:
#     1. $GH_TOKEN                         — if set, used for every repo (CI: the
#                                            one bootstrap secret / OIDC-minted token)
#     2. op read $GH_TOKEN_OP_REF          — 1Password ref for a PAT (local runs)
#                                            default: op://Goldberry Grove - Admin/Grove Infra/github_token
#     3. $GH_TOKEN_BROKER_URL/token?owner&repo — shared GitHub App token (sandbox)
#   The script does NOT assume any token can write everywhere: it pre-flights each
#   distinct repo (GET public-key) and, if the token cannot even read secrets,
#   marks every row for that repo `no-access` and moves on. Rows carrying a
#   `gate:` note in the manifest are intentionally skipped with the reason shown.
#
# Requires: op (signed in), gh, python3.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${SCRIPT_DIR}/../infra/ci-secrets.yaml"
GH_TOKEN_OP_REF="${GH_TOKEN_OP_REF:-op://Goldberry Grove - Admin/Grove Infra/github_token}"
DRY=0
REPO_FILTER=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  DRY=1;;
    --repo)     REPO_FILTER="$2"; shift;;
    --repo=*)   REPO_FILTER="${1#*=}";;
    --manifest) MANIFEST="$2"; shift;;
    --manifest=*) MANIFEST="${1#*=}";;
    -h|--help)  sed -n '2,40p' "$0"; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
  shift
done

command -v gh  >/dev/null || { echo "gh not found" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 1; }
[ -f "$MANIFEST" ] || { echo "manifest not found: $MANIFEST" >&2; exit 1; }

# --- token cache per repo (never printed) ----------------------------------
declare -A REPO_TOKEN REPO_READY
resolve_token() {
  local repo="$1"
  if [ -n "${REPO_TOKEN[$repo]:-}" ]; then return 0; fi
  local tok=""
  if [ -n "${GH_TOKEN:-}" ]; then
    tok="$GH_TOKEN"
  elif command -v op >/dev/null && tok=$(op read "$GH_TOKEN_OP_REF" 2>/dev/null) && [ -n "$tok" ]; then
    :
  elif [ -n "${GH_TOKEN_BROKER_URL:-}" ]; then
    tok=$(curl -s -m 5 "${GH_TOKEN_BROKER_URL}/token?owner=${repo%%/*}&repo=${repo##*/}" | sed 's/.*"token":"//;s/".*//')
  fi
  REPO_TOKEN[$repo]="$tok"
  [ -n "$tok" ]
}

# pre-flight: can this token READ secrets on the repo? (write is proven by the
# actual PUT — a 403 there is reported per-row, but no-read means skip early)
repo_ready() {
  local repo="$1"
  if [ -n "${REPO_READY[$repo]:-}" ]; then [ "${REPO_READY[$repo]}" = "1" ]; return; fi
  resolve_token "$repo" || { REPO_READY[$repo]=0; echo "  --   $repo  (no token available)"; return 1; }
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${REPO_TOKEN[$repo]}" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$repo/actions/secrets/public-key")
  if [ "$code" = "200" ]; then REPO_READY[$repo]=1; return 0; fi
  REPO_READY[$repo]=0
  echo "  --   $repo  (token cannot read secrets: HTTP $code — no-access)"
  return 1
}

ok=0 updated=0 skipped=0 failed=0
sync_row() {
  local op_ref="$1" repo="$2" name="$3" gate="$4"
  if [ -n "$gate" ]; then
    echo "  gate $repo $name  ($gate)"; skipped=$((skipped+1)); return
  fi
  repo_ready "$repo" || { skipped=$((skipped+1)); return; }

  local val
  if ! val=$(op read "$op_ref" </dev/null 2>/dev/null) || [ -z "$val" ]; then
    echo "  FAIL $repo $name  (cannot read op ref: $op_ref)" >&2; failed=$((failed+1)); return
  fi
  if [ "$DRY" = 1 ]; then
    echo "  would $repo $name  (value len=${#val})"; ok=$((ok+1)); unset val; return
  fi
  # value on stdin only — never argv, never logged
  if printf '%s' "$val" | GH_TOKEN="${REPO_TOKEN[$repo]}" gh secret set "$name" --repo "$repo" 2>/tmp/ghsecret.err; then
    # verify via metadata (proves the write landed; value never returned)
    local ts
    ts=$(GH_TOKEN="${REPO_TOKEN[$repo]}" gh api "repos/$repo/actions/secrets/$name" -q .updated_at 2>/dev/null || echo "?")
    echo "  ok   $repo $name  (updated_at=$ts)"; updated=$((updated+1))
  else
    echo "  FAIL $repo $name  ($(head -1 /tmp/ghsecret.err | sed 's/[A-Za-z0-9_-]\{20,\}/<redacted>/g'))" >&2
    failed=$((failed+1))
  fi
  unset val
}

[ "$DRY" = 1 ] && MODE="(dry-run) " || MODE=""
echo "== sync-ci-secrets ${MODE}manifest=$MANIFEST ${REPO_FILTER:+repo=$REPO_FILTER}=="
while IFS=$'\t' read -r op_ref repo name gate; do
  [ -z "${name:-}" ] && continue
  sync_row "$op_ref" "$repo" "$name" "${gate:-}"
done < <(python3 "${SCRIPT_DIR}/_parse-ci-secrets.py" "$MANIFEST" "$REPO_FILTER")

rm -f /tmp/ghsecret.err
echo "-- ok(dry)=$ok updated=$updated skipped=$skipped failed=$failed --"
[ "$failed" -eq 0 ]
