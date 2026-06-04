# Backup & Disaster Recovery — the AgenticOS "brain"

**Audience:** operator (Josh) + future agents. This is the durability plan for
the farm/business brain. It treats all three persistent stores as **primary**,
not "rebuildable in theory."

## The three stores

AgenticOS keeps state in three independent places. Losing any one degrades the
brain; the recovery story differs for each.

| Store | What it holds | Lives in | Backed up by | Faithfully rebuildable? |
|-------|---------------|----------|--------------|--------------------------|
| **Vault** | Human knowledge — Obsidian markdown (`wiki/`, `+inbox/`, `+sources/`) | `/opt/vault` | Syncthing → Mac (replica) | It *is* the source of truth |
| **Postgres** (`agenticos-db`) | Cost ledger, task/session ledger, `vault_ingest_state` dedup hashes | `agenticos-db-data` volume | `pg-backup.sh` → `/opt/backups` daily | No — only copy of cost/run history |
| **OpenViking** (`openviking-data`) | Agent memory: embeddings + LLM-extracted memories, sessions, relation graph | `openviking-data` volume | ⚠️ **not yet automated** | **No — see below** |

### Why OpenViking is NOT just a rebuildable cache

It is tempting to treat `openviking-data` as disposable because `vault-ingest.sh`
flows the vault into OpenViking hourly. That reasoning fails for a business brain:

1. **Extraction is non-deterministic.** `ov.conf` sets `memory.extraction_enabled: true`
   — OpenViking runs extraction over ingested content. A re-ingest yields *a*
   memory set, not *the* one you had.
2. **Not everything is vault-sourced.** Memories an agent writes directly via the
   API, plus session state and the relation graph, never exist as vault markdown.
   On volume loss they are gone — pure primary data.
3. **Rebuild ≠ availability.** Even a "faithful" re-ingest costs hours of local
   re-embedding (Ollama), during which a 24/7 brain runs degraded.

Embeddings themselves are deterministic (`nomic-embed-text`, fixed model), so a
restore can recompute vectors — but the *memories* and *graph* cannot be
reconstructed exactly. **Back it up.**

## Target posture — 3-2-1 on a $0 envelope

3 copies, 2 media, 1 off-site — achievable with DO + the Mac only (no paid
services):

1. **Live volumes** on the Droplet (copy 1).
2. **`/opt/backups`** on the Droplet — `pg-backup` + (pending) `viking-backup`
   dumps (copy 2, same box).
3. **Off-box** — `/opt/backups` replicated to the Mac via Syncthing (copy 3,
   different failure domain). **This is the highest-value gap today:** the pg
   dumps currently die with the Droplet because nothing ships `/opt/backups` off-box.

> **Replication is not backup.** Syncthing propagates a bad delete or corruption
> to the Mac just as faithfully as a good change. Pair it with **file
> versioning** (below) so there is a point-in-time undo.

## Procedures

### A. Postgres — automated ✅

- **Backup:** `infra/scripts/pg-backup.sh` (systemd `agenticos-pg-backup.timer`,
  daily 04:00) → `/opt/backups/agenticos-<UTC>.sql.gz`, newest 14 kept.
- **Restore:**

  ```bash
  gunzip < agenticos-<UTC>.sql.gz | \
    ssh deploy@$DROPLET 'docker compose -f /opt/agenticos/docker-compose.yml \
      exec -T agenticos-db psql -U agenticos agenticos'
  ```

### B. OpenViking — pack API ⚠️ (automation pending one live check)

OpenViking ships a native, app-consistent snapshot API:

- `POST /api/v1/pack/backup` — body `{"include_vectors": true}` for a
  self-contained pack (restore without re-embedding). Bearer auth +
  `X-OpenViking-Account: agenticos`.
- `POST /api/v1/pack/restore` — body `{"temp_file_id": "...", "on_conflict":
  "overwrite", "vector_mode": "auto"}`.

**Blocker before automating:** the vendored OpenAPI
(`docs/reference/openviking-v0.3.19-openapi.json`) leaves the `/pack/backup`
**200 response schema empty** — so where the pack artifact lands / how to
retrieve it is unverified. Do NOT ship a `viking-backup.sh` until this is
confirmed against the live server, or the job will go green while capturing
nothing.

**One-time verification probe** (run on the Droplet, where Viking is reachable
on the VPC; uses the root key in-situ — never echo it):

```bash
ssh deploy@$DROPLET '
  set -a; source /opt/agenticos/.env; set +a
  curl -fsS -X POST http://10.116.16.2:1933/api/v1/pack/backup \
    -H "Authorization: Bearer $OPENVIKING_ROOT_API_KEY" \
    -H "X-OpenViking-Account: agenticos" \
    -H "Content-Type: application/json" \
    -d "{\"include_vectors\": true}" | tee /tmp/pack-probe.json
  echo; echo "--- look for a path / temp_file_id / download handle in the above ---"
  # If it wrote a file inside the container, find it:
  docker exec openviking sh -lc "ls -lhrt /app/.openviking/data 2>/dev/null | tail" || true'
```

Once the artifact location is known, `viking-backup.sh` mirrors `pg-backup.sh`:
call the endpoint, retrieve the pack to `/opt/backups/openviking-<UTC>.ovpack`,
verify non-trivial size, rotate to newest 14, on its own daily systemd timer.

**Interim manual backup** (until automated) — tar the volume during a brief stop
(seconds of brain downtime; consistent because the process is paused):

```bash
ssh deploy@$DROPLET '
  cd /opt/agenticos
  docker compose stop openviking
  docker run --rm -v openviking-data:/data -v /opt/backups:/out alpine \
    tar czf /out/openviking-vol-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C /data .
  docker compose start openviking'
```

### C. Vault — Syncthing + versioning

- **Backup:** already replicated Mac ↔ Droplet via Syncthing.
- **Harden:** enable **Staggered File Versioning** on the vault folder in the
  Syncthing GUI (Droplet GUI is on `tailscale0:8384`) so deletes/overwrites are
  recoverable — replication alone is not. *(Operator step — interactive.)*

### D. Get `/opt/backups` off-box — the priority gap

Add `/opt/backups` as a Syncthing folder shared to the Mac (send-only from the
Droplet is fine). Then every `pg-backup` (and future `viking-backup`) artifact
lands on the Mac automatically — the off-site leg of 3-2-1, at $0.

*Operator step:* in the Droplet Syncthing GUI, **Add Folder** → path
`/opt/backups`, share with the Mac device; accept on the Mac. (Folder-add is
interactive; the classifier blocks agent-driven Syncthing reconfig.)

## Restore drills — an untested backup is not a backup

Do this **once now**, then quarterly. Targets: **RPO ≤ 24h** (daily backups),
**RTO ≤ 1h** (restore + verify).

1. **Postgres:** restore the latest dump into a scratch DB; confirm row counts in
   `tasks` / `calls` and that `/api/cost/today` math looks sane.
2. **OpenViking:** once B is automated, restore a pack into a throwaway Viking
   container; confirm `GET /api/v1/stats/memories` total matches and a sample
   `POST /api/v1/search/find` returns expected hits.
3. **Vault:** confirm the Mac replica opens in Obsidian and a recent capture is
   present; test the versioning trash recovers a deleted file.

Record the date + result here:

| Date | Postgres | OpenViking | Vault | Notes |
|------|----------|------------|-------|-------|
| *TBD (first drill)* | | | | |

## Optional: paid third failure domain

The above keeps everything on DO + Mac. For a true third site (Droplet *and* Mac
both gone), DO **weekly droplet snapshots** are a few cents/month — breaks the
strict $0 rule, so treat as an explicit business decision, not a default.
