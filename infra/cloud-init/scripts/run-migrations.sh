#!/usr/bin/env bash
# Run dashboard migrations against agenticos-db at Droplet boot.
# Idempotent: node-pg-migrate skips already-applied migrations.
set -euo pipefail

ENV_FILE=/opt/agenticos/.env
REPO=/opt/agenticos/repo/apps/dashboard

if [ ! -f "$ENV_FILE" ]; then
  echo "run-migrations: $ENV_FILE missing; skipping" >&2
  exit 0
fi
if [ ! -d "$REPO" ]; then
  echo "run-migrations: $REPO missing; skipping" >&2
  exit 0
fi

# Wait for db to be ready
for i in $(seq 1 30); do
  if docker exec agenticos-db pg_isready -U agenticos >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

set -a
. "$ENV_FILE"
set +a

export AGENTICOS_DB_URL="postgresql://agenticos:${AGENTICOS_DB_PASSWORD}@127.0.0.1:5432/agenticos"

cd "$REPO"
sudo -u deploy -E bash -lc 'pnpm migrate:up'
