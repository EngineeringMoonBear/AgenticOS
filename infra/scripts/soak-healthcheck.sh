#!/usr/bin/env bash
# AgenticOS soak / "is the brain healthy?" check.
#
# One command that verifies the whole self-hosted stack is operating on its own:
# containers, the hourly vault-ingest cron, the daily-brief + cost-report cron
# jobs, the pg + OpenViking backups, and OpenViking's own consistency. Built for
# the Phase 8 soak (run it once a day for the soak window) but it doubles as the
# permanent on-demand health probe afterwards.
#
# Run on the Droplet as the `deploy` user:
#   bash /opt/agenticos/repo/infra/scripts/soak-healthcheck.sh
#
# Exit code: 0 if no FAILs (WARNs allowed), 1 if any check FAILs. Each check is
# isolated — a probe whose assumption is slightly off prints its raw value and
# WARNs rather than aborting the run, so you always get the full picture.
#
# Overridable via env: COMPOSE_FILE, BACKUP_DIR, OPENVIKING_URL, OV_CONF,
# HERMES_BIN, DB_USER, DB_NAME, INGEST_MAX_AGE_MIN, BACKUP_MAX_AGE_MIN.
set -u

COMPOSE_FILE="${COMPOSE_FILE:-/opt/agenticos/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
OPENVIKING_URL="${OPENVIKING_URL:-http://10.116.16.2:1933}"
OV_CONF="${OV_CONF:-/opt/agenticos/openviking-config/ov.conf}"
HERMES_BIN="${HERMES_BIN:-/opt/hermes/.venv/bin/hermes}"
DB_USER="${DB_USER:-agenticos}"
DB_NAME="${DB_NAME:-agenticos}"
INGEST_MAX_AGE_MIN="${INGEST_MAX_AGE_MIN:-90}"      # vault-ingest is hourly; allow slack
BACKUP_MAX_AGE_MIN="${BACKUP_MAX_AGE_MIN:-1560}"    # 26h: daily backup + slack

PASS=0
WARN=0
FAIL=0

c_pass() { printf '  \033[32m[PASS]\033[0m %s\n' "$*"; PASS=$((PASS + 1)); }
c_warn() { printf '  \033[33m[WARN]\033[0m %s\n' "$*"; WARN=$((WARN + 1)); }
c_fail() { printf '  \033[31m[FAIL]\033[0m %s\n' "$*"; FAIL=$((FAIL + 1)); }
hdr()    { printf '\n\033[1m%s\033[0m\n' "$*"; }

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

# psql helper: runs a single -At query against agenticos-db, returns stdout.
psql_q() {
  dc exec -T agenticos-db psql -U "$DB_USER" "$DB_NAME" -At -c "$1" 2>/dev/null
}

echo "=== AgenticOS soak health-check — $(date -u +%FT%TZ) ==="

# ---------------------------------------------------------------------------
hdr "1. Container health + restart counts"
# hermes-gateway has no Docker healthcheck (cron sidecar) — for it we only
# require State.Status=running. The rest expose a health probe.
for name in agenticos-db openviking ollama hermes-agent hermes-gateway; do
  if ! docker inspect "$name" >/dev/null 2>&1; then
    c_fail "$name: container not found"
    continue
  fi
  state=$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null)
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null)
  restarts=$(docker inspect -f '{{.RestartCount}}' "$name" 2>/dev/null)
  if [ "$state" != "running" ]; then
    c_fail "$name: state=$state (expected running)"
  elif [ "$health" = "unhealthy" ]; then
    c_fail "$name: health=unhealthy"
  elif [ "${restarts:-0}" -gt 2 ]; then
    c_warn "$name: running but RestartCount=$restarts (investigate crash-looping)"
  else
    c_pass "$name: state=$state health=$health restarts=${restarts:-0}"
  fi
done

# ---------------------------------------------------------------------------
hdr "2. vault-ingest — last hourly run clean + fresh"
row=$(psql_q "SELECT status, COALESCE(metadata->>'errored','?'), \
  ROUND(EXTRACT(EPOCH FROM (now() - started_at))/60)::int \
  FROM tasks WHERE kind='vault-ingest' ORDER BY started_at DESC LIMIT 1")
if [ -z "$row" ]; then
  c_fail "no vault-ingest rows in tasks table (cron not running?)"
else
  IFS='|' read -r vi_status vi_err vi_age <<EOF
$row
EOF
  if [ "$vi_status" = "done" ] && [ "$vi_err" = "0" ] && [ "${vi_age:-9999}" -le "$INGEST_MAX_AGE_MIN" ]; then
    c_pass "last run: status=$vi_status errored=$vi_err age=${vi_age}min"
  else
    [ "$vi_status" != "done" ] && c_fail "last run status=$vi_status (expected done)"
    [ "$vi_err" != "0" ] && c_fail "last run errored=$vi_err (expected 0)"
    [ "${vi_age:-9999}" -gt "$INGEST_MAX_AGE_MIN" ] && c_warn "last run age=${vi_age}min > ${INGEST_MAX_AGE_MIN}min (cron may be stalled)"
  fi
fi

# ---------------------------------------------------------------------------
hdr "3. Cron jobs registered in Hermes"
cronlist=$(docker exec hermes-gateway "$HERMES_BIN" cron list 2>/dev/null)
if [ -z "$cronlist" ]; then
  c_warn "could not read 'hermes cron list' from hermes-gateway (HERMES_BIN=$HERMES_BIN?)"
else
  for job in vault-ingest daily-brief cost-report; do
    if printf '%s\n' "$cronlist" | grep -qE "(^|[[:space:]])${job}([[:space:]]|$)"; then
      c_pass "registered: $job"
    else
      c_fail "missing cron job: $job"
    fi
  done
fi

# ---------------------------------------------------------------------------
hdr "4. daily-brief + cost-report — last recorded run"
# These are deterministic shell jobs; they record into tasks when they run.
# Before their first daily fire there may be no row yet → WARN, not FAIL.
for job in daily-brief cost-report; do
  jrow=$(psql_q "SELECT status, ROUND(EXTRACT(EPOCH FROM (now() - started_at))/3600)::int \
    FROM tasks WHERE kind='$job' ORDER BY started_at DESC LIMIT 1")
  if [ -z "$jrow" ]; then
    c_warn "$job: no run recorded yet (expected after its first scheduled fire)"
  else
    IFS='|' read -r j_status j_age_h <<EOF
$jrow
EOF
    if [ "$j_status" = "done" ]; then
      c_pass "$job: last status=$j_status (${j_age_h}h ago)"
    else
      c_fail "$job: last status=$j_status (${j_age_h}h ago)"
    fi
  fi
done

# ---------------------------------------------------------------------------
hdr "5. Backups present, fresh (<${BACKUP_MAX_AGE_MIN}min), and sized"
check_backup() {
  local label=$1 glob=$2 min_bytes=$3
  local newest
  newest=$(find "$BACKUP_DIR" -maxdepth 1 -name "$glob" -type f 2>/dev/null | sort | tail -1)
  if [ -z "$newest" ]; then
    c_warn "$label: no $glob in $BACKUP_DIR yet (expected after first scheduled backup)"
    return
  fi
  local size fresh
  size=$(stat -c%s "$newest" 2>/dev/null || stat -f%z "$newest" 2>/dev/null)
  fresh=$(find "$newest" -mmin "-${BACKUP_MAX_AGE_MIN}" 2>/dev/null)
  if [ -z "$fresh" ]; then
    c_fail "$label: newest ($(basename "$newest")) older than ${BACKUP_MAX_AGE_MIN}min — timer not firing?"
  elif [ "${size:-0}" -lt "$min_bytes" ]; then
    c_fail "$label: newest ($(basename "$newest")) only ${size}B (< ${min_bytes}B floor) — likely corrupt"
  else
    c_pass "$label: $(basename "$newest") ${size}B, fresh"
  fi
}
check_backup "pg-backup"     "agenticos-*.sql.gz"  1024
check_backup "viking-backup" "openviking-*.ovpack" 1024

# ---------------------------------------------------------------------------
hdr "6. OpenViking consistency + vector count"
OV_KEY=$(sed -n 's/.*"root_api_key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$OV_CONF" 2>/dev/null)
if [ -z "$OV_KEY" ]; then
  c_warn "could not read root_api_key from $OV_CONF — skipping OpenViking probes"
else
  ov_curl() {
    curl -s -m 15 -H "Authorization: Bearer $OV_KEY" \
      -H "X-OpenViking-Account: agenticos" -H "X-OpenViking-User: deploy" "$@"
  }
  cons=$(ov_curl "$OPENVIKING_URL/api/v1/system/consistency")
  if printf '%s' "$cons" | grep -qiE '"status"[[:space:]]*:[[:space:]]*"(ok|healthy|consistent)"|"consistent"[[:space:]]*:[[:space:]]*true'; then
    c_pass "system/consistency OK"
  elif [ -z "$cons" ]; then
    c_fail "system/consistency: no response (OpenViking unreachable at $OPENVIKING_URL)"
  else
    c_warn "system/consistency returned: $(printf '%s' "$cons" | head -c 200)"
  fi
  vcount=$(ov_curl "$OPENVIKING_URL/api/v1/debug/vector/count")
  vnum=$(printf '%s' "$vcount" | sed -n 's/.*"count"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')
  if [ -n "$vnum" ] && [ "$vnum" -gt 0 ]; then
    c_pass "vector count = $vnum"
  elif [ -n "$vnum" ]; then
    c_warn "vector count = 0 (memory store empty?)"
  else
    c_warn "vector count: could not parse ($(printf '%s' "$vcount" | head -c 120))"
  fi
fi

# ---------------------------------------------------------------------------
printf '\n\033[1m=== Summary: %d PASS / %d WARN / %d FAIL ===\033[0m\n' "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "RESULT: FAIL — investigate the [FAIL] lines above."
  exit 1
fi
if [ "$WARN" -gt 0 ]; then
  echo "RESULT: PASS (with warnings) — warnings are expected early in the soak (e.g. before first daily backup/cron fire)."
  exit 0
fi
echo "RESULT: PASS — stack healthy."
exit 0
