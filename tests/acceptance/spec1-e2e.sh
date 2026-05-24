#!/usr/bin/env bash
# Spec 1 end-to-end acceptance: drop a note on Mac → verify the whole inbox-
# triage pipeline fires (Syncthing → inbox-watcher → SLM triage → vault move
# → telemetry → dashboard).
#
# Prereqs:
#   - Mac has ~/AgenticOS-Vault paired via Syncthing to Droplet /opt/vault
#   - SSH key at ~/.ssh/agenticos-droplet authorized for deploy@<droplet>
#   - Droplet stack is up (agenticos-db, hermes-agent, inbox-watcher, ...)
#
# Usage:
#   ./tests/acceptance/spec1-e2e.sh
#
# Idempotent: each run uses a unique timestamped filename.
set -euo pipefail

VAULT_LOCAL="${VAULT_LOCAL:-$HOME/AgenticOS-Vault}"
# Tailscale MagicDNS (agenticos-droplet) is the documented host, but the
# tailnet ACL may block SSH; fall back to the public IP if needed.
DROPLET_HOST="${DROPLET_HOST:-159.223.171.231}"
DROPLET_USER="${DROPLET_USER:-deploy}"
DROPLET="${DROPLET_USER}@${DROPLET_HOST}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/agenticos-droplet}"
SSH="ssh -i $SSH_KEY -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"

TIMEOUT="${TIMEOUT:-120}"
NOTE_NAME="spec1-acceptance-$(date +%s).md"
LOCAL_NOTE="$VAULT_LOCAL/inbox/$NOTE_NAME"

DASHBOARD_URL="${DASHBOARD_URL:-https://agenticos.gatheringatthegrove.com}"
CF_COOKIE_FILE="${CF_COOKIE_FILE:-$HOME/.config/agenticos-test-cookie}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

psql_at() {
  # $1 = SQL; runs against the dockerized Postgres on the Droplet.
  $SSH "$DROPLET" "docker exec agenticos-db psql -U agenticos -d agenticos -At -c \"$1\""
}

echo "=== 0. Preflight ==="
[ -d "$VAULT_LOCAL" ] || fail "vault not mounted at $VAULT_LOCAL"
[ -f "$SSH_KEY" ] || fail "ssh key missing: $SSH_KEY"
$SSH "$DROPLET" "echo ok >/dev/null" || fail "cannot ssh to $DROPLET"
echo "Mac vault: $VAULT_LOCAL"
echo "Droplet:   $DROPLET"
echo "Note:      $NOTE_NAME"

echo
echo "=== 1. Drop note on Mac ==="
mkdir -p "$VAULT_LOCAL/inbox"
cat > "$LOCAL_NOTE" <<EOF
# Pasture rotation notes - late spring

Quick note from the farm: the south paddock is grazed down to ~3 inches,
time to rotate the herd to the east field. Re-seed clover where the
stocking density compacted the soil near the gate. Email Sarah about
the marketing photos for next week's CSA newsletter.
EOF
echo "Wrote $LOCAL_NOTE ($(wc -c < "$LOCAL_NOTE") bytes)"

echo
echo "=== 2. Wait for Syncthing → Droplet (up to ${TIMEOUT}s) ==="
REPLICATED=""
for i in $(seq 1 $TIMEOUT); do
  if $SSH "$DROPLET" "[ -f /opt/vault/inbox/$NOTE_NAME ]" 2>/dev/null; then
    echo "Replicated after ${i}s"
    REPLICATED=1
    break
  fi
  sleep 1
done
[ -n "$REPLICATED" ] || fail "note never appeared on Droplet at /opt/vault/inbox/$NOTE_NAME"

echo
echo "=== 3. Wait for inbox-triage to complete (up to ${TIMEOUT}s) ==="
STATUS=""
TASK_ID=""
for i in $(seq 1 $TIMEOUT); do
  ROW=$(psql_at "SELECT id || '|' || status FROM tasks WHERE metadata->>'file' LIKE '%$NOTE_NAME' ORDER BY started_at DESC LIMIT 1;" 2>/dev/null || echo "")
  if [ -n "$ROW" ]; then
    TASK_ID="${ROW%|*}"
    STATUS="${ROW#*|}"
    if [ "$STATUS" = "done" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "budget-blocked" ]; then
      echo "Triage finished after ${i}s (task=$TASK_ID status=$STATUS)"
      break
    fi
  fi
  sleep 2
done

[ "$STATUS" = "done" ] || fail "triage did not complete cleanly (task=$TASK_ID status=$STATUS)"

echo
echo "=== 4. Verify file moved out of inbox ==="
$SSH "$DROPLET" "[ ! -f /opt/vault/inbox/$NOTE_NAME ]" || fail "file still in /opt/vault/inbox"
echo "OK - file is gone from inbox"

echo
echo "=== 5. Verify file landed under a category/subfolder ==="
RELOCATED=$($SSH "$DROPLET" "find /opt/vault -name $NOTE_NAME -not -path '*/inbox/*' 2>/dev/null" || true)
[ -n "$RELOCATED" ] || fail "could not find $NOTE_NAME anywhere outside /opt/vault/inbox"
echo "Found at:"
echo "$RELOCATED" | sed 's/^/  /'

echo
echo "=== 6. Wait for Syncthing → Mac (up to ${TIMEOUT}s) ==="
MAC_FOUND=""
for i in $(seq 1 $TIMEOUT); do
  MAC_FOUND=$(find "$VAULT_LOCAL" -name "$NOTE_NAME" -not -path "*/inbox/*" 2>/dev/null | head -1)
  if [ -n "$MAC_FOUND" ]; then
    echo "Replicated back to Mac after ${i}s at: $MAC_FOUND"
    break
  fi
  sleep 1
done
[ -n "$MAC_FOUND" ] || echo "WARN: file did not replicate back to Mac within ${TIMEOUT}s (Syncthing may be slow; not failing)"

echo
echo "=== 7. Verify task and calls rows ==="
echo "--- task ---"
$SSH "$DROPLET" "docker exec agenticos-db psql -U agenticos -d agenticos -c \"SELECT id, kind, status, cost_cents, metadata->>'file' AS file FROM tasks WHERE id = '$TASK_ID';\""

CALL_COUNT=$(psql_at "SELECT COUNT(*) FROM calls WHERE task_id = '$TASK_ID';")
echo "calls rows for task: $CALL_COUNT"
[ "${CALL_COUNT:-0}" -ge 1 ] || fail "no calls rows recorded for task $TASK_ID"
echo "--- calls (latest) ---"
$SSH "$DROPLET" "docker exec agenticos-db psql -U agenticos -d agenticos -c \"SELECT provider, model, input_tokens, output_tokens, cost_cents, latency_ms FROM calls WHERE task_id = '$TASK_ID' ORDER BY occurred_at;\""

echo
echo "=== 8. (Best-effort) Verify dashboard /api/cost/today ==="
if [ -f "$CF_COOKIE_FILE" ] && [ -s "$CF_COOKIE_FILE" ]; then
  if curl -fsS "$DASHBOARD_URL/api/cost/today" \
      -H "Cookie: $(cat "$CF_COOKIE_FILE")" \
      | python3 -m json.tool | head -30; then
    echo "Dashboard responded OK"
  else
    echo "WARN: dashboard /api/cost/today did not return JSON; cookie may be stale"
  fi
else
  echo "SKIP: no CF Access cookie at $CF_COOKIE_FILE"
  echo "      To enable this check, log in via browser, copy the CF_Authorization"
  echo "      cookie, and write it to $CF_COOKIE_FILE as 'CF_Authorization=<value>'."
fi

echo
echo "✅ Spec 1 acceptance PASSED"
echo "   task_id=$TASK_ID"
echo "   note=$NOTE_NAME"
echo "   relocated_to=$(echo "$RELOCATED" | head -1)"
