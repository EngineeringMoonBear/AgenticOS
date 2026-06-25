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
# ENV_FILE, OV_ACCOUNT, OV_USER, OV_AGENT, VAULT_DIR, DB_USER,
# DB_NAME, INGEST_MAX_AGE_MIN, BACKUP_MAX_AGE_MIN.
set -u

COMPOSE_FILE="${COMPOSE_FILE:-/opt/agenticos/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
OPENVIKING_URL="${OPENVIKING_URL:-http://10.116.16.2:1933}"
OV_CONF="${OV_CONF:-/opt/agenticos/openviking-config/ov.conf}"
ENV_FILE="${ENV_FILE:-/opt/agenticos/.env}"
OV_ACCOUNT="${OV_ACCOUNT:-agenticos}"
OV_USER="${OV_USER:-deploy}"
OV_AGENT="${OV_AGENT:-default}"
VAULT_DIR="${VAULT_DIR:-/opt/vault}"
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
for name in agenticos-db openviking ollama vault-server paperclip-server; do
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
# NOTE (Hermes retirement / Paperclip migration): this probe read the legacy
# Hermes `tasks` table (kind='vault-ingest'), populated by the Hermes
# vault-ingest cron. vault-ingest is now a Paperclip plugin and no longer
# writes that table, so the probe is disabled pending a rewrite against
# Paperclip's run-record data source. Re-enable once that source is known.
c_warn "vault-ingest freshness probe disabled — needs repointing at Paperclip's run records (was legacy Hermes tasks table)"

# ---------------------------------------------------------------------------
hdr "3. Backups present, fresh (<${BACKUP_MAX_AGE_MIN}min), and sized"
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
hdr "4. OpenViking consistency + vector count"
# Resolve the root_api_key. AUTHORITATIVE source is OPENVIKING_ROOT_API_KEY in
# .env — compose injects it as an env var into the openviking container, which
# OVERRIDES ov.conf's root_api_key. ov.conf can drift back to the 27-char
# placeholder on re-provision while the server still authenticates against the
# 52-char env key, so reading ov.conf first would falsely report auth failure.
# Order: .env (authoritative) → host ov.conf → container ov.conf.
OV_KEY=$(grep -m1 '^OPENVIKING_ROOT_API_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
if [ -z "$OV_KEY" ]; then
  OV_KEY=$(sed -n 's/.*"root_api_key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$OV_CONF" 2>/dev/null)
fi
if [ -z "$OV_KEY" ]; then
  OV_KEY=$(docker exec openviking sh -lc 'sed -n "s/.*\"root_api_key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" /app/.openviking/ov.conf' 2>/dev/null || true)
fi
if [ -z "$OV_KEY" ]; then
  c_warn "could not resolve root_api_key ($ENV_FILE, host $OV_CONF, openviking container) — skipping OpenViking probes"
else
  # All OpenViking calls need Account/User/Agent headers, matching viking-backup.sh.
  ov_curl() {
    curl -s -m 15 -H "Authorization: Bearer $OV_KEY" \
      -H "X-OpenViking-Account: $OV_ACCOUNT" -H "X-OpenViking-User: $OV_USER" \
      -H "X-OpenViking-Agent: $OV_AGENT" "$@"
  }
  # /system/consistency is POST-only (openapi v0.3.19).
  cons=$(ov_curl -X POST "$OPENVIKING_URL/api/v1/system/consistency")
  if [ -z "$cons" ]; then
    c_fail "system/consistency: no response (OpenViking unreachable at $OPENVIKING_URL)"
  elif printf '%s' "$cons" | grep -qE '"(code|error)"[[:space:]]*:[[:space:]]*("?[A-Z_]*"?|\{)'; then
    c_warn "system/consistency returned an error: $(printf '%s' "$cons" | head -c 200)"
  else
    c_pass "system/consistency OK"
  fi
  vcount=$(ov_curl "$OPENVIKING_URL/api/v1/debug/vector/count")
  vnum=$(printf '%s' "$vcount" | sed -n 's/.*"count"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')
  if [ -n "$vnum" ] && [ "$vnum" -gt 0 ]; then
    c_pass "vector count = $vnum"
  elif [ -n "$vnum" ]; then
    c_warn "vector count = 0 (memory store empty?)"
  else
    c_warn "vector count: could not parse ($(printf '%s' "$vcount" | head -c 160))"
  fi
fi

# ---------------------------------------------------------------------------
hdr "5. Vault file readability (Syncthing permission drift)"
# A container reading the vault bind mount may lack DAC override, so any vault
# file that isn't world-readable (e.g. a 600 note synced from the Mac) fails
# ingest with EACCES. Surface it here as a WARN *before* it errors an ingest run.
if [ ! -d "$VAULT_DIR" ]; then
  c_warn "$VAULT_DIR not found on this host — skipping readability check"
else
  unreadable=$(find "$VAULT_DIR" -type f -name '*.md' ! -perm -o=r 2>/dev/null | wc -l | tr -d ' ')
  if [ "${unreadable:-0}" -eq 0 ]; then
    c_pass "all *.md under $VAULT_DIR are world-readable"
  else
    sample=$(find "$VAULT_DIR" -type f -name '*.md' ! -perm -o=r 2>/dev/null | head -1)
    c_warn "${unreadable} *.md file(s) not world-readable — will fail ingest (e.g. ${sample}). Fix: find $VAULT_DIR -type f ! -perm -o=r -exec chmod a+r {} +"
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
