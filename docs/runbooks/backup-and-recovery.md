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
| **OpenViking** (`openviking-data`) | Agent memory: embeddings + LLM-extracted memories, sessions, relation graph | `openviking-data` volume | `viking-backup.sh` → `/opt/backups` daily | **No — see below** |

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

**Verified contract** (probed against the live v0.3.19 server, 2026-06-04):
`POST /api/v1/pack/backup` returns **HTTP 200 with the pack streamed directly as
the response body** — a ZIP (`.ovpack`) containing `files/{resources,user,agent,
session}/…` + `_ovpack/manifest.json` + `index_records.jsonl`. There is no
`temp_file_id` or server-side path to chase: you save the body with `curl -o`.
Auth = `Authorization: Bearer <root_api_key from ov.conf>` plus the
`X-OpenViking-{Account,User,Agent}` tenant headers.

Use **`include_vectors: false`**: the `true` mode 400s
(`Cannot export incomplete OpenViking vector index snapshot`) whenever any
record is still pending embedding — too brittle for an unattended job — and
vectors recompute deterministically on restore (`nomic-embed-text`), so nothing
is lost. The pack is smaller without them.

**Backup:** automated by `infra/scripts/viking-backup.sh` (systemd
`agenticos-viking-backup.timer`, daily 04:30) →
`/opt/backups/openviking-<UTC>.ovpack`, newest 14 kept. Integrity gates: HTTP
200 (`curl -f`), min-size, ZIP magic `PK`, and `unzip -t` CRC check when
available — so a refusal or truncated stream never overwrites or rotates away a
good pack.

**Restore** (two-step — upload the pack, then restore it):

```bash
# 1. temp_upload the .ovpack → returns a temp_file_id
FID=$(curl -fsS -X POST http://10.116.16.2:1933/api/v1/resources/temp_upload \
  -H "Authorization: Bearer $KEY" -H "X-OpenViking-Account: agenticos" \
  -F file=@openviking-<UTC>.ovpack | jq -r '.result.temp_file_id')
# 2. restore (recompute vectors, overwrite on conflict)
curl -fsS -X POST http://10.116.16.2:1933/api/v1/pack/restore \
  -H "Authorization: Bearer $KEY" -H "X-OpenViking-Account: agenticos" \
  -H "Content-Type: application/json" \
  -d "{\"temp_file_id\": \"$FID\", \"on_conflict\": \"overwrite\", \"vector_mode\": \"recompute\"}"
```

> Confirm the exact `temp_upload` field name + response path against the live
> server on first real restore (drill it — see below); the two-step shape is
> from the OpenAPI but the upload field was not probed.

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

## Rotating `AGENTICOS_DB_PASSWORD` on an existing Droplet

The Postgres password has **one source of truth**: 1Password
(`op://Goldberry Grove - Admin/AgenticOS Infra/agenticos_db_password`).
Terraform passes it both to App Platform (which builds the dashboard's
`AGENTICOS_DB_URL`) and into the Droplet's cloud-init, which UPSERTs it
into `/opt/agenticos/.env` on every (re-)provision so the two never
drift. **But:** the `agenticos-db` container only consults
`POSTGRES_PASSWORD` on the *first* init of its `agenticos-db-data`
volume. Rewriting `.env` alone does **not** rotate the actual role
password on an existing Droplet — newly-started containers will read
the new value from `.env` and then fail to authenticate against
Postgres, which still has the old role password baked into its volume.

To actually rotate:

1. Update the value in 1Password.
2. On the Droplet, ALTER the role to match — the canonical move:
   ```bash
   NEW_PW=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/agenticos_db_password")
   docker exec -i agenticos-db psql -U agenticos -d agenticos \
     -c "ALTER USER agenticos WITH PASSWORD '$NEW_PW';"
   ```
3. `terraform apply` (or wait for the next plan) to re-render `.env` on
   the Droplet and push the new value to App Platform's env. Restart
   the consumers (`docker compose restart`) so they pick up the new
   `.env`; redeploy the App Platform app so the dashboard picks up the
   new `AGENTICOS_DB_URL`.

The only alternative is a **volume reset** — destroy `agenticos-db-data`
and let the container re-init with the new password. That nukes all
Postgres state (cost ledger, run history, dedup hashes) and requires a
restore from `/opt/backups`. Don't do this for a routine rotation.

## Gotcha: DO "Reset root password" locks you out of SSH

If you use DigitalOcean's **Reset root password**, the account is flagged
**password-expired / must-change-on-next-login**. Until you complete the change
via the **Console**, *all* SSH logins fail — **including key-based ones** — with
`all configured authentication methods failed`. Your key still works at the
`publickey` step; PAM's *account* phase then rejects the session because the
password is expired. (Interleaved power-cycles show as `Connection refused`.)

- **It is not a broken key, a bad deploy, or lost data** — don't panic-restore a
  snapshot over it.
- **Fix:** open DO → Droplet → **Console**, log in as `root` with the temp
  password, set a new one. That clears the expired flag and SSH works again.
- `deploy` is SSH-key-only with a *locked* password (its `sudo` is `NOPASSWD`
  for `systemctl`/`ufw` only). To get general `sudo`, set its password as root:
  `passwd deploy` (don't use `passwd -e` / `chage -d 0` — that re-triggers the
  same expired-account lockout). Stash both passwords in 1Password.

## Optional: paid third failure domain

The above keeps everything on DO + Mac. For a true third site (Droplet *and* Mac
both gone), DO **weekly droplet snapshots** are a few cents/month — breaks the
strict $0 rule, so treat as an explicit business decision, not a default.
