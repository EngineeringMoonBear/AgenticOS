#!/usr/bin/env bash
# Automated Postgres backup for the AgenticOS cost-telemetry DB.
#
# Dumps the `agenticos` database (cost rows + task/session ledger) from the
# agenticos-db container to ${BACKUP_DIR} as a gzipped SQL file, then prunes
# dumps beyond the retention window. Installed as a systemd timer
# (agenticos-pg-backup.timer) — see infra/cloud-init/droplet-bootstrap.yaml.tpl.
#
# Protects against volume corruption, a bad migration, or an accidental
# `docker compose down -v`. It does NOT by itself survive total Droplet loss —
# for that, copy ${BACKUP_DIR} off-box (see infra/README.md "Backups").
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-/opt/agenticos/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
DB_CONTAINER="${DB_CONTAINER:-agenticos-db}"
DB_NAME="${DB_NAME:-agenticos}"
DB_USER="${DB_USER:-agenticos}"
RETENTION="${RETENTION:-14}" # keep this many most-recent dumps

log() { echo "[$(date -u +%FT%TZ)] pg-backup: $*" >&2; }

mkdir -p "${BACKUP_DIR}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/agenticos-${STAMP}.sql.gz"
TMP="${OUT}.tmp"

cleanup() { rm -f "${TMP}"; }
trap cleanup EXIT

log "dumping ${DB_NAME} → ${OUT}"

# -T: no TTY (systemd/cron context). Pipe straight into gzip; `set -o pipefail`
# makes a pg_dump failure abort the script before we keep a truncated file.
docker compose -f "${COMPOSE_FILE}" exec -T "${DB_CONTAINER}" \
  pg_dump -U "${DB_USER}" "${DB_NAME}" | gzip >"${TMP}"

# Sanity gate: a real gzipped dump is never just a few bytes (the gzip header
# alone is ~20). This catches the silent-failure case where pg_dump errored but
# gzip still emitted a tiny, useless file.
SIZE="$(stat -c%s "${TMP}" 2>/dev/null || stat -f%z "${TMP}")"
if [ "${SIZE}" -lt 100 ]; then
  log "ERROR: dump suspiciously small (${SIZE} bytes); aborting without rotating"
  exit 1
fi

# Atomic publish: a partial dump never overwrites a known-good one.
mv "${TMP}" "${OUT}"
log "wrote ${OUT} (${SIZE} bytes)"

# Rotation: keep the newest ${RETENTION} dumps, delete the rest. A bash glob
# expands already lexically sorted, and the UTC stamp (YYYYmmddTHHMMSSZ) sorts
# lexically == chronologically, so DUMPS is oldest-first — no `ls` needed (and
# the controlled filenames sidestep word-splitting hazards entirely).
shopt -s nullglob
DUMPS=("${BACKUP_DIR}"/agenticos-*.sql.gz)
shopt -u nullglob
if [ "${#DUMPS[@]}" -gt "${RETENTION}" ]; then
  PRUNE=("${DUMPS[@]:0:${#DUMPS[@]}-RETENTION}")
  log "pruning ${#PRUNE[@]} dump(s) beyond retention=${RETENTION}"
  rm -f "${PRUNE[@]}"
fi

log "done"
