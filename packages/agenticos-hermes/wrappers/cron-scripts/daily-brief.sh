#!/bin/bash
# Hermes cron wrapper for the daily-brief task.
#
# Invoked by `hermes cron` with --no-agent — meaning Hermes does NOT load an
# LLM agent; this script IS the job. Its stdout is delivered verbatim to
# the configured destination (in our case, the brief is written directly to
# /opt/vault/daily-briefs/YYYY-MM-DD.md inside the Python task; cron stdout
# is just for logging).
#
# Hermes resolves --script paths under $HERMES_HOME/scripts/ — for our
# gateway container that's /opt/data/scripts/, bind-mounted from this dir
# in repo.
set -euo pipefail
exec /opt/hermes/.venv/bin/python -m agenticos_hermes.tasks.daily_brief
