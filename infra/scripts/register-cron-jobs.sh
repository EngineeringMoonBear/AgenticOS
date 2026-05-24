#!/bin/bash
# Register AgenticOS cron jobs in Hermes (idempotent).
#
# Why this exists: cron jobs are stored in HERMES_HOME/cron/jobs.json which
# is volume-persisted (hermes-data). On a fresh Droplet that volume is empty,
# so we register our two cron jobs at first boot. Subsequent runs are no-ops
# thanks to the `--name` existence check.
#
# Why the dashboard container (not gateway): gateway needs to be running to
# tick the scheduler at minute boundaries, but `hermes cron create` writes
# to the shared jobs.json file — either container can do the write.
# Dashboard is reachable via `docker exec hermes-agent ...` from cloud-init.
#
# Schedule format: standard cron (minute hour dom month dow). Timezone is
# whatever the container sees — we set TZ=America/New_York on both Hermes
# containers in docker-compose.yml.
set -euo pipefail

HERMES_BIN=${HERMES_BIN:-/opt/hermes/.venv/bin/hermes}

# Use --name as the idempotency key. If `cron list` already lists the name,
# skip; otherwise create. List output is one job per line with the name
# visible in column 2 — grep for the exact name token.
register() {
  local name=$1
  local schedule=$2
  local script=$3

  if "$HERMES_BIN" cron list 2>/dev/null | grep -qE "^\s*[^[:space:]]+\s+${name}(\s|$)"; then
    echo "register-cron-jobs: ${name} already registered, skipping"
    return 0
  fi

  echo "register-cron-jobs: creating ${name} (schedule=${schedule}, script=${script})"
  "$HERMES_BIN" cron create "$schedule" \
    --name "$name" \
    --script "$script" \
    --no-agent
}

register daily-brief "0 7 * * *"  daily-brief.sh
register cost-report "0 23 * * *" cost-report.sh

echo "register-cron-jobs: done"
"$HERMES_BIN" cron list 2>&1 | head -20
