#!/bin/bash
# Hermes cron wrapper for the cost-report task.
#
# Same pattern as daily-brief.sh — runs with --no-agent, delegates to the
# Python entrypoint at agenticos_hermes.tasks.cost_report. Writes to
# /opt/vault/cost-reports/YYYY-MM-DD.md inside the task; cron stdout is
# for logs only.
set -euo pipefail
exec /opt/hermes/.venv/bin/python -m agenticos_hermes.tasks.cost_report
