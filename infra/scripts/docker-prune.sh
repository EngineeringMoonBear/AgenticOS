#!/usr/bin/env bash
# AgenticOS host Docker reclaim — reclaims the /var/lib/docker accretion that
# builds up across CI deploys (dangling image layers, stopped containers,
# unused networks, and the BuildKit build cache). Run weekly by the
# agenticos-docker-prune.timer systemd unit; also safe to run by hand as the
# deploy user.
#
# Why this exists (GOL-131 / GOL-124): the 77G droplet hit 87-89% because
# ~57G lived host-side under /var/lib/docker with no reclaim policy. Each CI
# deploy does `docker compose up -d --build`, which leaves the previous image
# layers + build cache behind.
#
# What it prunes:
#   docker system prune -af   → all stopped containers, unused networks,
#                               dangling AND unused images, and build cache.
#                               RUNNING containers and the images they use are
#                               NOT touched, so live services are safe.
#   docker builder prune -af  → belt-and-suspenders on the BuildKit cache
#                               (the biggest single accretor on this box).
#
# What it deliberately does NOT do: `--volumes`. Named volumes on this droplet
# hold LIVE state (agenticos-db Postgres data, OpenViking memory, vault). A
# volume prune here would be data loss. Volume hygiene, if ever needed, is a
# separate, reviewed operation — never automated in this timer.
set -euo pipefail

LOG_TS() { date '+%Y-%m-%dT%H:%M:%S%z'; }

echo "[$(LOG_TS)] docker-prune: start"
echo "[$(LOG_TS)] disk BEFORE:"
df -h / | sed 's/^/    /'
docker system df 2>/dev/null | sed 's/^/    /' || true

echo "[$(LOG_TS)] docker system prune -af (keeps running containers + in-use images; no --volumes)"
docker system prune -af

echo "[$(LOG_TS)] docker builder prune -af (BuildKit cache)"
docker builder prune -af

echo "[$(LOG_TS)] disk AFTER:"
df -h / | sed 's/^/    /'
docker system df 2>/dev/null | sed 's/^/    /' || true
echo "[$(LOG_TS)] docker-prune: done"
