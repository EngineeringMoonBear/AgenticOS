#!/usr/bin/env bash
# AgenticOS disk-guard — early-warning + self-heal for droplet root FS.
#
# Runs daily via agenticos-disk-guard.timer. Checks root filesystem usage and:
#   - at/above WARN_PCT (default 80): posts to the Discord ops webhook so we
#     catch it BEFORE the DigitalOcean monitor fires at 85%, then runs the
#     docker-prune reclaim and re-checks.
#   - below WARN_PCT: silent (no webhook spam), exits 0.
#
# Why 80 and not 85: the DO monitor at 85% is the last line of defence; this
# gives an earlier, actionable signal + an automatic reclaim attempt so most
# spikes self-heal without a human ever seeing the DO alert.
#
# The Discord webhook URL is read from /opt/agenticos/.env
# (DISCORD_OPS_WEBHOOK_URL). If it is unset, the script still prunes and logs
# but skips the webhook (so a fresh box without the secret degrades gracefully).
#
# In-container Paperclip agents cannot read the host filesystem or reach the
# host Docker socket, so this guard is codified as a HOST systemd timer rather
# than a Paperclip agent routine. The companion Paperclip routine
# ("DevOps disk-hygiene review") is oversight only — it does not replace this.
set -euo pipefail

WARN_PCT="${WARN_PCT:-80}"
ENV_FILE="${ENV_FILE:-/opt/agenticos/.env}"
REPO="${REPO:-/opt/agenticos/repo}"
HOSTNAME_SHORT="$(hostname -s 2>/dev/null || echo agenticos-droplet)"

LOG_TS() { date '+%Y-%m-%dT%H:%M:%S%z'; }

# Root FS usage as an integer percent.
USE_PCT="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
echo "[$(LOG_TS)] disk-guard: root FS at ${USE_PCT}% (warn threshold ${WARN_PCT}%)"

if [ "${USE_PCT:-0}" -lt "${WARN_PCT}" ]; then
  echo "[$(LOG_TS)] disk-guard: under threshold, nothing to do"
  exit 0
fi

post_discord() { # $1 = message
  local url=""
  if [ -f "${ENV_FILE}" ]; then
    url="$(grep -E '^DISCORD_OPS_WEBHOOK_URL=' "${ENV_FILE}" | cut -d= -f2- || true)"
  fi
  if [ -z "${url}" ]; then
    echo "[$(LOG_TS)] disk-guard: DISCORD_OPS_WEBHOOK_URL unset — skipping webhook" >&2
    return 0
  fi
  curl -fsS -m 15 -H 'Content-Type: application/json' \
    -d "$(jq -n --arg c "$1" '{content:$c}')" \
    "${url}" >/dev/null 2>&1 \
    && echo "[$(LOG_TS)] disk-guard: posted to Discord ops webhook" \
    || echo "[$(LOG_TS)] disk-guard: WARN webhook post failed" >&2
}

post_discord ":warning: **${HOSTNAME_SHORT}** root FS at **${USE_PCT}%** (>=${WARN_PCT}%). Running docker-prune reclaim…"

# Attempt reclaim.
if [ -x "${REPO}/infra/scripts/docker-prune.sh" ]; then
  "${REPO}/infra/scripts/docker-prune.sh" || echo "[$(LOG_TS)] disk-guard: docker-prune returned non-zero" >&2
else
  echo "[$(LOG_TS)] disk-guard: ${REPO}/infra/scripts/docker-prune.sh not found/executable" >&2
fi

AFTER_PCT="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
echo "[$(LOG_TS)] disk-guard: root FS after reclaim ${AFTER_PCT}%"

if [ "${AFTER_PCT:-100}" -ge "${WARN_PCT}" ]; then
  post_discord ":rotating_light: **${HOSTNAME_SHORT}** still at **${AFTER_PCT}%** after prune — needs a human look (volumes / logs / non-Docker growth)."
else
  post_discord ":white_check_mark: **${HOSTNAME_SHORT}** reclaimed to **${AFTER_PCT}%** after prune."
fi
