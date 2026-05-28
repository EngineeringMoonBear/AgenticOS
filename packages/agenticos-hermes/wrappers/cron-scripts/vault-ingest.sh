#!/bin/bash
# Hermes cron wrapper for the vault-ingest task.
#
# Walks /opt/vault hourly and pushes new/changed *.md files to OpenViking
# via the two-step temp_upload → add_resource flow. Hash-dedups against
# the vault_ingest_state Postgres table so unchanged files cost nothing.
#
# Same pattern as daily-brief.sh — runs with --no-agent, delegates to the
# Python entrypoint at agenticos_hermes.tasks.vault_ingest. The Python
# module emits its own tasks-ledger row; cron stdout is for logs only.
#
# Hermes resolves --script paths under $HERMES_HOME/scripts/ — for our
# gateway container that's /opt/data/scripts/, bind-mounted from this dir
# in repo.
set -euo pipefail
exec /opt/hermes/.venv/bin/python -m agenticos_hermes.tasks.vault_ingest
