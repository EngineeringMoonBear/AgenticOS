# AgenticOS → OpenObserve (P1 rich observability) — GOL-54

Ships the AgenticOS Droplet's **host + per-container USE metrics** to the shared Grove
**obs-droplet OpenObserve**, closing the gap the Grove Observability design blueprints but never
built. Parent: **GOL-51** · P0 sibling: `agenticos-oom-mitigation.md` (DO-native alerts + swap +
mem_limits) · this is **P1 (GOL-54)**.

> **Layering:** the DO-native alerts (`infra/terraform/monitor-alerts.tf`, P0) are the fast,
> obs-droplet-independent detection layer. This collector is the rich, single-pane layer. Two
> independent paths by design — keep both.

## What ships here

| Piece | File |
|---|---|
| Collector config (hostmetrics + docker_stats → OpenObserve, `host.role=agenticos`) | `infra/otel/otelcol-agenticos.yaml` |
| `otel-collector` service (profile `observability`, mem_limit 200m, `/hostfs`+docker.sock ro) | `docker-compose.yml` |
| Conditional start on deploy (only if `OPENOBSERVE_OTLP_BASE` set) | `.github/workflows/deploy-droplet.yml` |
| Ingest env vars | `infra/secrets.env.example` → `/opt/agenticos/.env` |

The OpenObserve/Keep **alert rules** (`agenticos-*`, mirroring the `droplet-*` >70%/>90%/10min
patterns) configure the obs-droplet's OpenObserve, which is provisioned from the `odoocker`
monitoring stack — not this repo. Those land there once the obs-droplet is confirmed live (see
"Enable" below). DO-native alerts cover the box meanwhile.

## Why push-out (no circular dependency)

AgenticOS is its own failure domain. The collector exports metrics **out** to the obs-droplet
rather than the obs-droplet scraping in. If the obs-droplet dies, AgenticOS keeps running and the
DO-native alerts still fire; if AgenticOS dies, the obs-droplet already holds the last window of
metrics. The collector has its own `mem_limit: 200m` — the watcher must not OOM the box it watches.

## Enable (once the obs-droplet ingest endpoint exists)

The collector is behind the `observability` compose profile and does **not** start until the obs
endpoint is configured, so merging this PR is safe on a box with no obs-droplet yet.

1. Put the ingest config in `/opt/agenticos/.env` on the Droplet (via the 1Password secret
   pipeline, `infra/scripts/load-secrets.sh` conventions):
   ```
   OPENOBSERVE_OTLP_BASE=https://obs.gatheringatthegrove.com/api/default
   OPENOBSERVE_ROOT_EMAIL=...
   OPENOBSERVE_ROOT_PASSWORD=...
   ```
2. Re-run **Deploy Droplet** (push to `main` touching `docker-compose.yml`/`infra/otel/**`, or
   `workflow_dispatch`). The `Reconcile otel-collector` step detects `OPENOBSERVE_OTLP_BASE` and
   runs `docker compose --profile observability up -d otel-collector`.
   Manual equivalent on the box: `cd /opt/agenticos && docker compose --profile observability up -d otel-collector`.

## Verify

1. `docker logs -f otel-collector` → no exporter auth/connection errors.
2. In obs-droplet OpenObserve, query streams `system_cpu_utilization`, `system_memory_utilization`,
   `container_memory_percent`, `system_filesystem_utilization`, `system_paging_utilization`
   filtered `host.role = "agenticos"` → rows within ~1 min.
3. Alert→Discord (once the `agenticos-*` OpenObserve rules land on the obs-droplet): briefly lower
   the memory-warning threshold, or `stress-ng --vm 1 --vm-bytes 80% -t 12m`, and confirm the card.

## Rollback

```bash
cd /opt/agenticos && docker compose rm -sf otel-collector
```
Stops shipping metrics; the DO-native alerts remain, so the box is never fully unmonitored. To
fully remove, drop the service from `docker-compose.yml` + `infra/otel/` and re-deploy.

## Caveats / follow-ups

- **Stream/field names + `host_role` predicate are "pending live validation"** — confirm on first
  end-to-end deploy; adjust the exporter / downstream alert filters if live names differ.
- **Least privilege (security):** the collector uses OpenObserve **root** basicauth today.
  Provision a scoped ingest-only user on the obs-droplet and swap `OPENOBSERVE_ROOT_*`.
- **OpenObserve alert rules** (`agenticos-*`) are the remaining P1 sub-piece; they live in the
  obs stack config (`odoocker` `openobserve/alerts.json`), gated on the obs-droplet being live.
