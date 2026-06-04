#!/usr/bin/env bash
# Automated backup of the OpenViking agent-memory store (the "brain").
#
# Calls OpenViking's native POST /api/v1/pack/backup, which streams a ZIP
# (.ovpack) of the whole memory store — including agent/session/user memories
# that never exist as vault markdown (files/user/<u>/memories/*, files/agent/*,
# files/session/*). Saves it to ${BACKUP_DIR} and prunes to a retention window.
# Installed as a systemd timer (agenticos-viking-backup.timer).
#
# Why include_vectors=false (verified against the live server):
#   - `true` refuses with INVALID_ARGUMENT whenever the vector index is
#     incomplete (any record still pending embedding) — too brittle for an
#     unattended nightly job.
#   - vectors are deterministic (nomic-embed-text, fixed model), so restore
#     recomputes them (RestoreRequest vector_mode=auto/recompute) with no loss.
#   - the pack is smaller without them.
#
# Restore: POST /api/v1/pack/import (temp_upload the .ovpack) then
# /api/v1/pack/restore. See docs/runbooks/backup-and-recovery.md §B.
set -euo pipefail

OPENVIKING_URL="${OPENVIKING_URL:-http://10.116.16.2:1933}"
OV_CONF="${OV_CONF:-/opt/agenticos/openviking-config/ov.conf}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
OV_ACCOUNT="${OV_ACCOUNT:-agenticos}"
OV_USER="${OV_USER:-deploy}"
OV_AGENT="${OV_AGENT:-default}"
RETENTION="${RETENTION:-14}" # keep this many most-recent packs
TIMEOUT="${TIMEOUT:-120}"    # seconds; large stores take a while to pack

log() { echo "[$(date -u +%FT%TZ)] viking-backup: $*" >&2; }

# Resolve the root API key. Prefer the host-mounted ov.conf (read-only bind of
# the same file the server reads); fall back to reading it from the running
# container. Never printed — only its presence/length is logged.
read_key() {
  local k=""
  if [ -r "${OV_CONF}" ]; then
    k="$(sed -n 's/.*"root_api_key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${OV_CONF}")"
  fi
  if [ -z "${k}" ] && command -v docker >/dev/null 2>&1; then
    k="$(docker exec openviking sh -lc 'sed -n "s/.*\"root_api_key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" /app/.openviking/ov.conf' 2>/dev/null || true)"
  fi
  printf '%s' "${k}"
}

KEY="$(read_key)"
if [ -z "${KEY}" ]; then
  log "ERROR: could not resolve OpenViking root_api_key (looked in ${OV_CONF} and the openviking container)"
  exit 1
fi
log "key resolved (len ${#KEY})"

mkdir -p "${BACKUP_DIR}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/openviking-${STAMP}.ovpack"
TMP="${OUT}.tmp"

cleanup() { rm -f "${TMP}"; }
trap cleanup EXIT

log "requesting pack → ${OUT}"

# -f: fail (and write nothing) on HTTP >=400, so a refusal never leaves a
# truncated .ovpack behind. The 200 body IS the ZIP, captured with -o.
HTTP="$(curl -fsS -o "${TMP}" -w '%{http_code}' \
  --max-time "${TIMEOUT}" \
  -X POST "${OPENVIKING_URL}/api/v1/pack/backup" \
  -H "Authorization: Bearer ${KEY}" \
  -H "X-OpenViking-Account: ${OV_ACCOUNT}" \
  -H "X-OpenViking-User: ${OV_USER}" \
  -H "X-OpenViking-Agent: ${OV_AGENT}" \
  -H "Content-Type: application/json" \
  -d '{"include_vectors": false}')" || {
  log "ERROR: pack request failed (HTTP ${HTTP:-?}); leaving prior backups untouched"
  exit 1
}

# Integrity gates — a backup you can't restore is worse than none.
SIZE="$(stat -c%s "${TMP}" 2>/dev/null || stat -f%z "${TMP}")"
if [ "${SIZE}" -lt 100 ]; then
  log "ERROR: pack suspiciously small (${SIZE} bytes); aborting without rotating"
  exit 1
fi
# The .ovpack is a ZIP — verify the magic, and if `unzip` is present, verify the
# whole archive's CRCs (catches a truncated/corrupt stream that still has a
# PK header).
if [ "$(head -c2 "${TMP}")" != "PK" ]; then
  log "ERROR: pack does not start with ZIP magic 'PK'; aborting"
  exit 1
fi
if command -v unzip >/dev/null 2>&1; then
  if ! unzip -tqq "${TMP}" >/dev/null 2>&1; then
    log "ERROR: ZIP integrity check (unzip -t) failed; aborting without rotating"
    exit 1
  fi
fi

mv "${TMP}" "${OUT}"
log "wrote ${OUT} (${SIZE} bytes)"

# Rotation: keep the newest ${RETENTION}. The UTC stamp sorts lexically ==
# chronologically, so a sorted glob is oldest-first — no `ls`, controlled names.
shopt -s nullglob
PACKS=("${BACKUP_DIR}"/openviking-*.ovpack)
shopt -u nullglob
if [ "${#PACKS[@]}" -gt "${RETENTION}" ]; then
  PRUNE=("${PACKS[@]:0:${#PACKS[@]}-RETENTION}")
  log "pruning ${#PRUNE[@]} pack(s) beyond retention=${RETENTION}"
  rm -f "${PRUNE[@]}"
fi

log "done"
