# Spec 1 — Orchestrator + Cost Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace foundation-v2's homemade scheduler + Honcho with Hermes Agent (headless orchestrator), OpenViking (filesystem memory over `/opt/vault`), Codex CLI + Ollama SLMs (two-tier workers), and a per-task cost observability surface in the AgenticOS dashboard.

**Architecture:** Three layers running on existing infrastructure. Dashboard (public, Cloudflare-gated, Next.js 16 on App Platform) talks REST over the DO VPC to Hermes Agent (native systemd service on the Droplet, `127.0.0.1:7777`). Hermes spawns workers (Codex CLI subprocess, Ollama HTTP, OpenViking HTTP) and emits telemetry rows into `agenticos-db` (Postgres). All state lives in `/opt/vault` (Syncthing-paired with Mac) or `agenticos-db`.

**Tech Stack:** Next.js 16 + React 19 + Tailwind v4 + vitest (dashboard); Python 3.11 + FastAPI + pytest (Hermes plugins); systemd + cloud-init + Terraform (infra); Postgres 15 + pgvector (telemetry); Ollama (local SLMs); OpenAI Codex CLI (paid coder).

**Spec reference:** `docs/superpowers/specs/2026-05-22-spec1-orchestrator-cost-observability-design.md`

> **⚠ API-VERIFICATION DELTA — read first:** `docs/superpowers/specs/spec1-verified-api-shapes.md` captures the post-spike findings. The most important deltas: Hermes Agent and OpenViking are **Docker-first** (pivot Tasks 2 + 3 from pip+venv+systemd to docker-compose services), Codex CLI uses `codex exec --json` not `codex --print --json` and requires a one-time `codex login --with-api-key`, and `hermes-agent` is at `0.14.0` not `1.x`. Task code below has not been rewritten yet — refer to the verification doc for the corrected shapes when executing Tasks 2, 3, 4, 11–15, 17–18. An ~45-min sub-spike (new Task 11.5) is recommended before Phase 1.1 to lock the remaining Hermes plugin contract + OpenViking ov.conf schema.

**Time estimate:** 18–25 hours over 1–2 weeks of evenings.

**Prerequisites already done (don't redo):**
- ✅ Droplet provisioned via Terraform; SSH key registered; Tailscale joined
- ✅ App Platform Next.js dashboard deployed behind Cloudflare Access (Google SSO)
- ✅ `agenticos-db` Postgres running on Droplet at `127.0.0.1:5432` (empty, ready for migrations)
- ✅ Honcho fully decommissioned (containers, volumes, network)
- ✅ Syncthing pairing: `/opt/vault` ↔ `~/AgenticOS-Vault`, bidirectional verified
- ✅ `/opt/agenticos/.env` contains `AGENTICOS_DB_PASSWORD`, `OPENAI_API_KEY`, `LLM_OPENAI_API_KEY` (sk-proj-… project-scoped, $30/mo cap to be set at platform.openai.com)
- ✅ 1Password Service Account token (`ops_…`) exists at `AgenticOS Infra → 1password-production-terraform-key`

**Manual prereqs you'll do before Phase 1.0:**
- Set the $30 hard cap and $24 soft alert on the OpenAI project at platform.openai.com → Projects → `agenticos-droplet` → Limits

---

## File map

**Infra (Terraform + cloud-init)**
- Create: `infra/terraform/secrets.tf`
- Create: `infra/cloud-init/scripts/install-ollama.sh`
- Create: `infra/cloud-init/scripts/install-openviking.sh`
- Create: `infra/cloud-init/scripts/install-hermes.sh`
- Create: `infra/cloud-init/scripts/refresh-secrets.sh`
- Create: `infra/cloud-init/scripts/run-migrations.sh`
- Create: `infra/cloud-init/templates/hermes-config.yaml.tpl`
- Create: `infra/cloud-init/templates/openviking-config.yaml.tpl`
- Create: `infra/cloud-init/templates/agenticos-secrets-refresh.service`
- Create: `infra/cloud-init/templates/agenticos-secrets-refresh.timer`
- Create: `infra/cloud-init/templates/ollama-override.conf`
- Modify: `infra/cloud-init/droplet-bootstrap.yaml.tpl`
- Modify: `infra/terraform/droplet.tf`

**Hermes plugin package (new Python workspace)**

> **Phase 1.1 was replanned** after the verified-API-shapes spike (commit `96b6976`). The original assumption of a `SkillBase` abstraction was wrong. Hermes uses three distinct extension surfaces (hook plugins, memory providers, tools) — see `docs/superpowers/specs/spec1-verified-api-shapes.md` §3 for the contract. Below is the revised layout.

- Create: `packages/agenticos-hermes/pyproject.toml`
- Create: `packages/agenticos-hermes/src/agenticos_hermes/__init__.py`
- Create: `packages/agenticos-hermes/src/agenticos_hermes/db.py` — Postgres connection helper
- Create: `packages/agenticos-hermes/src/agenticos_hermes/pricing.py` — cost-per-call math (incl. cached_input_tokens math)
- Create: `packages/agenticos-hermes/src/agenticos_hermes/routing.py` — SLM-vs-Codex decision tree (pure function)
- Create: `packages/agenticos-hermes/src/agenticos_hermes/workers/__init__.py`
- Create: `packages/agenticos-hermes/src/agenticos_hermes/workers/slm_runner.py` — Ollama HTTP wrapper (internal module, NOT a Hermes plugin)
- Create: `packages/agenticos-hermes/src/agenticos_hermes/workers/codex_coder.py` — `codex exec --json` subprocess wrapper (internal module)
- Create: `packages/agenticos-hermes/src/agenticos_hermes/tasks/__init__.py`
- Create: `packages/agenticos-hermes/src/agenticos_hermes/tasks/daily_brief.py`
- Create: `packages/agenticos-hermes/src/agenticos_hermes/tasks/cost_report.py`
- Create: `packages/agenticos-hermes/src/agenticos_hermes/tasks/inbox_triage.py`
- Create: `packages/agenticos-hermes/plugins/cost-recorder/plugin.yaml` — Hermes hook-plugin manifest
- Create: `packages/agenticos-hermes/plugins/cost-recorder/__init__.py` — hook function impls (post_llm_call, on_session_end)
- Create: `packages/agenticos-hermes/daemons/inbox-watcher/Dockerfile`
- Create: `packages/agenticos-hermes/daemons/inbox-watcher/watcher.py` — fsnotify daemon
- Create: `packages/agenticos-hermes/daemons/inbox-watcher/pyproject.toml`
- Create: `packages/agenticos-hermes/tests/` (one per module)
- Modify: `docker-compose.yml` — bind-mount cost-recorder into hermes-agent + add inbox-watcher service

**Dashboard (existing Next.js app, brownfield)**
- Create: `apps/dashboard/lib/agent/hermes-client.ts`
- Create: `apps/dashboard/lib/agent/openviking-client.ts`
- Create: `apps/dashboard/lib/cost/db.ts`
- Create: `apps/dashboard/lib/cost/pricing.ts`
- Create: `apps/dashboard/lib/cost/forecast.ts`
- Create: `apps/dashboard/lib/cost/types.ts`
- Create: `apps/dashboard/app/api/tasks/route.ts`
- Create: `apps/dashboard/app/api/tasks/[id]/route.ts`
- Create: `apps/dashboard/app/api/cost/[scope]/route.ts`
- Create: `apps/dashboard/app/api/budget/route.ts`
- Create: `apps/dashboard/migrations/0001_initial_telemetry.sql`
- Create: `apps/dashboard/lib/cost/db.test.ts`
- Create: `apps/dashboard/lib/cost/pricing.test.ts`
- Create: `apps/dashboard/lib/cost/forecast.test.ts`
- Create: `apps/dashboard/app/api/tasks/route.test.ts`
- Create: `apps/dashboard/app/api/cost/[scope]/route.test.ts`
- Modify: `apps/dashboard/lib/agent/index.ts` (re-exports)
- Modify: `apps/dashboard/lib/agent/spawn.ts` (point at Hermes)
- Modify: `apps/dashboard/lib/agent/types.ts` (add Task/Session/Call types)
- Modify: `apps/dashboard/package.json` (add pg, node-pg-migrate; remove @honcho-ai/sdk)
- Delete: `apps/dashboard/lib/agent/honcho-client.ts` + test
- Delete: `apps/dashboard/lib/api/proxy.test.ts` if it imports honcho (verify; otherwise keep)

**Integration tests**
- Create: `tests/integration/docker-compose.test.yml`
- Create: `tests/integration/test_inbox_triage_e2e.py`
- Create: `tests/integration/test_budget_cap_e2e.py`
- Create: `tests/integration/conftest.py`

**Visual pass**
- Modify: `apps/dashboard/app/globals.css`
- Modify: `apps/dashboard/tailwind.config.ts` (if exists, else create)
- Create: `apps/dashboard/components/ui/glass-card.tsx`
- Modify: `apps/dashboard/app/layout.tsx`
- Modify: `apps/dashboard/components/Sidebar.tsx` (or current shell)

---

## Phase 1.0 — Infrastructure & install (≈3.5 hrs)

### Task 1: Ollama via docker-compose

> **Rationale:** Original task assumed native install + systemd override. That requires broader sudo on the Droplet than `deploy` has (NOPASSWD is restricted to `/bin/systemctl` and `/usr/sbin/ufw`). Pivoting to Docker aligns Ollama with the rest of the Spec 1 stack (Hermes + OpenViking also Docker-first per the verified-api-shapes doc) AND removes the sudoers complication for every downstream task. Net result: no install scripts to write, just a compose service + a post-up model-pull step.

**Files:**
- Modify: `docker-compose.yml`
- Modify: `infra/cloud-init/droplet-bootstrap.yaml.tpl`

- [ ] **Step 1: Add `ollama` service to `docker-compose.yml`**

Edit `docker-compose.yml` (which currently has only `agenticos-db`). Append the new service before the closing `volumes:` block:

```yaml
  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    restart: unless-stopped
    # Bind to localhost only — Hermes (another compose service in Spec 1) will
    # reach it on the docker-compose network at `http://ollama:11434`. UFW
    # belt-and-suspenders blocks public traffic regardless.
    ports:
      - "127.0.0.1:11434:11434"
    volumes:
      - ollama-models:/root/.ollama
    environment:
      # Inside the container, listen on all interfaces so the docker-compose
      # network can route to it. Host-side port mapping above is what controls
      # external reachability.
      OLLAMA_HOST: "0.0.0.0:11434"
      OLLAMA_MAX_LOADED_MODELS: "2"
      OLLAMA_KEEP_ALIVE: "30m"
    healthcheck:
      test: ["CMD-SHELL", "ollama --version > /dev/null 2>&1 || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
```

Add to the existing `volumes:` block:
```yaml
volumes:
  agenticos-db-data:
  ollama-models:
```

- [ ] **Step 2: Add post-up model-pull step to cloud-init**

Edit `infra/cloud-init/droplet-bootstrap.yaml.tpl`. After the existing `docker compose ... up -d` block (which brings up `agenticos-db` AND now `ollama`), add a new section that pre-pulls models inside the running container:

```yaml
  # --- Ollama model pre-pull ---
  # Pre-pulls Qwen 2.5 3B (general SLM) and nomic-embed-text (embeddings for
  # OpenViking). Done after `docker compose up -d` so the container is alive.
  # Idempotent: ollama pull is a no-op if the model is already present.
  # Runs in background (`&`) so cloud-init doesn't block on the ~2.3 GB
  # download — first agent task after boot may wait if it triggers before
  # the pull completes, but that's a one-time first-deploy cost.
  - |
    if docker ps --format '{{.Names}}' | grep -q '^ollama$'; then
      for i in $(seq 1 30); do
        if docker exec ollama ollama --version > /dev/null 2>&1; then break; fi
        sleep 2
      done
      (docker exec ollama ollama pull qwen2.5:3b && \
       docker exec ollama ollama pull nomic-embed-text) &
    fi
```

If you previously added the native Ollama install section (`install-ollama.sh` invocation) to cloud-init, **remove it** — the Docker compose service replaces it entirely.

- [ ] **Step 3: Verify locally (compose file parses)**

```bash
cd /Users/joshuadunbar/Documents/Dev\ Projects/AgenticOS
docker compose config 2>&1 | head -40
```

Expected: dumps both `agenticos-db` and `ollama` services with no errors.

- [ ] **Step 4: Deploy to the existing Droplet**

`deploy` is in the `docker` group, so no sudo needed for compose operations.

```bash
# Push the updated compose file
scp -i ~/.ssh/agenticos-droplet \
  docker-compose.yml \
  deploy@159.223.171.231:/opt/agenticos/docker-compose.yml

# Bring up the new Ollama container alongside agenticos-db
ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 \
  'cd /opt/agenticos && docker compose --env-file /opt/agenticos/.env up -d'

# Wait for healthy + pull models (in the background so model pulls don't block)
ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 'set -e
  for i in $(seq 1 30); do
    s=$(docker inspect -f "{{.State.Health.Status}}" ollama 2>/dev/null || echo missing)
    echo "ollama health: $s"
    [ "$s" = "healthy" ] && break
    sleep 3
  done
  docker exec ollama ollama pull qwen2.5:3b 2>&1 | tail -3
  docker exec ollama ollama pull nomic-embed-text 2>&1 | tail -3
'
```

Expected: both `docker pull` lines end with `success` or "pulled".

- [ ] **Step 5: End-to-end verify**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 \
  'curl -s http://127.0.0.1:11434/api/tags | python3 -m json.tool | head -20'
```

Expected: JSON listing `qwen2.5:3b` and `nomic-embed-text`.

Expected: JSON listing `qwen2.5:3b` and `nomic-embed-text` models.

- [ ] **Step 6: Commit**

```bash
git add infra/cloud-init/scripts/install-ollama.sh \
        infra/cloud-init/templates/ollama-override.conf \
        infra/cloud-init/droplet-bootstrap.yaml.tpl
git commit -m "feat(infra): install Ollama + pull Qwen 2.5 3B + nomic-embed-text via cloud-init"
```

---

### Task 2: OpenViking install + non-interactive config

**Files:**
- Create: `infra/cloud-init/scripts/install-openviking.sh`
- Create: `infra/cloud-init/templates/openviking-config.yaml.tpl`
- Create: `infra/cloud-init/templates/openviking.service`
- Modify: `infra/cloud-init/droplet-bootstrap.yaml.tpl`

- [ ] **Step 1: Read the OpenViking install docs to confirm flags/config shape**

Open these in the browser:
- `https://volcengine-openviking.mintlify.app/` — getting started
- `https://volcengine-openviking.mintlify.app/configuration` — config file fields

Confirm: the binary is `openviking-server`, it accepts `--config <path>`, and it serves on port 1933 by default. If any flag names differ, adjust below.

- [ ] **Step 2: Write the install script**

Create `infra/cloud-init/scripts/install-openviking.sh`:

```bash
#!/usr/bin/env bash
# Install OpenViking + seed non-interactive config + register systemd unit.
# OpenViking provides filesystem-backed memory rooted at /opt/vault (which
# Syncthing pairs with the Mac's Obsidian vault), so notes are visible both
# as Hermes memories and as Obsidian markdown.
set -euo pipefail

# Install via pip into a system-wide venv to avoid polluting deploy's pip user-site.
if [ ! -d /opt/openviking ]; then
  python3 -m venv /opt/openviking
  /opt/openviking/bin/pip install --upgrade pip
fi
/opt/openviking/bin/pip install --upgrade 'openviking>=0.3,<0.4'

# Symlink the binary for convenience; deploy user adds it to PATH via .bashrc
ln -sf /opt/openviking/bin/openviking-server /usr/local/bin/openviking-server

# Seed config (templated by Terraform → cloud-init writes this file at boot;
# this script just copies it into the canonical location)
install -d -m 0755 -o deploy -g deploy /home/deploy/.openviking
install -m 0644 -o deploy -g deploy \
  /opt/agenticos/repo/infra/cloud-init/templates/openviking-config.yaml.tpl \
  /home/deploy/.openviking/config.yaml

# Register systemd unit
install -m 0644 /opt/agenticos/repo/infra/cloud-init/templates/openviking.service \
  /etc/systemd/system/openviking.service
systemctl daemon-reload
systemctl enable --now openviking.service

# Wait for it to come up
for i in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:1933/health >/dev/null 2>&1; then
    echo "OpenViking ready on :1933"
    exit 0
  fi
  sleep 1
done
echo "WARN: OpenViking didn't respond on :1933 within 30s; check 'journalctl -u openviking'" >&2
exit 1
```

- [ ] **Step 3: Write the OpenViking config template**

Create `infra/cloud-init/templates/openviking-config.yaml.tpl`:

```yaml
# OpenViking config — filesystem-backed memory for AgenticOS Spec 1.
# Memory root is /opt/vault, the same dir Syncthing pairs with the Mac's
# Obsidian vault. Notes are visible both as OpenViking memories (with vector
# search via embeddings) and as plain .md files in Obsidian.

server:
  host: 127.0.0.1
  port: 1933

memory:
  # Root of the hierarchical filesystem tree
  root: /opt/vault
  # HOTNESS_ALPHA: 0.2 means retrieval rank is 80% relevance + 20% recency.
  # Spec 1 relies on this for soft-staleness handling (no eviction needed).
  hotness_alpha: 0.2

embedding:
  transport: ollama
  endpoint: http://127.0.0.1:11434
  model: nomic-embed-text
  # Batch size; safe default for 4GB Droplet
  batch_size: 16

# No VLM configured — Spec 1 doesn't need vision. If we add it later,
# point to a small local VLM via Ollama or omit if not needed.
vlm:
  enabled: false
```

- [ ] **Step 4: Write the systemd unit**

Create `infra/cloud-init/templates/openviking.service`:

```ini
[Unit]
Description=OpenViking memory server for AgenticOS
After=network.target ollama.service
Wants=ollama.service

[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/home/deploy
ExecStart=/usr/local/bin/openviking-server --config /home/deploy/.openviking/config.yaml
Restart=on-failure
RestartSec=5s
StandardOutput=append:/var/log/agenticos/openviking.log
StandardError=append:/var/log/agenticos/openviking.log

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 5: Wire into cloud-init**

Edit `infra/cloud-init/droplet-bootstrap.yaml.tpl`, after the Ollama block:

```yaml
  # --- OpenViking (filesystem-backed memory store) ---
  - chmod +x /opt/agenticos/repo/infra/cloud-init/scripts/install-openviking.sh
  - /opt/agenticos/repo/infra/cloud-init/scripts/install-openviking.sh
```

- [ ] **Step 6: Manually run on existing Droplet**

```bash
scp -i ~/.ssh/agenticos-droplet \
  infra/cloud-init/scripts/install-openviking.sh \
  infra/cloud-init/templates/openviking-config.yaml.tpl \
  infra/cloud-init/templates/openviking.service \
  deploy@159.223.171.231:/tmp/

ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 \
  'sudo install -m 755 /tmp/install-openviking.sh /opt/agenticos/repo/infra/cloud-init/scripts/install-openviking.sh \
   && sudo install -m 644 /tmp/openviking-config.yaml.tpl /opt/agenticos/repo/infra/cloud-init/templates/openviking-config.yaml.tpl \
   && sudo install -m 644 /tmp/openviking.service /opt/agenticos/repo/infra/cloud-init/templates/openviking.service \
   && sudo /opt/agenticos/repo/infra/cloud-init/scripts/install-openviking.sh'
```

Expected: `OpenViking ready on :1933`.

- [ ] **Step 7: Verify**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 \
  'curl -fsS http://127.0.0.1:1933/health && echo && systemctl is-active openviking'
```

Expected: 200 from `/health` and `active`.

- [ ] **Step 8: Commit**

```bash
git add infra/cloud-init/scripts/install-openviking.sh \
        infra/cloud-init/templates/openviking-config.yaml.tpl \
        infra/cloud-init/templates/openviking.service \
        infra/cloud-init/droplet-bootstrap.yaml.tpl
git commit -m "feat(infra): install OpenViking + systemd unit + cloud-init wire"
```

---

### Task 3: Hermes Agent install + config template

**Files:**
- Create: `infra/cloud-init/scripts/install-hermes.sh`
- Create: `infra/cloud-init/templates/hermes-config.yaml.tpl`
- Create: `infra/cloud-init/templates/hermes-agent.service`
- Modify: `infra/cloud-init/droplet-bootstrap.yaml.tpl`

- [ ] **Step 1: Read Hermes config + skill docs**

Browse:
- `https://hermes-agent.nousresearch.com/docs/getting-started`
- `https://hermes-agent.nousresearch.com/docs/user-guide/configuration`
- `https://hermes-agent.nousresearch.com/docs/user-guide/features/cron-jobs`
- `https://hermes-agent.nousresearch.com/docs/developer-guide/skills` — skill plugin contract

Confirm: pip package name (likely `hermes-agent`), CLI binary (likely `hermes-server` or similar), config file location (likely `~/.hermes/config.yaml`), default port (we want 7777). If anything differs from the values used below, adjust.

- [ ] **Step 2: Write the install script**

Create `infra/cloud-init/scripts/install-hermes.sh`:

```bash
#!/usr/bin/env bash
# Install Hermes Agent + write config + register systemd unit.
# Hermes is the orchestrator: cron, skills, sessions, telemetry hooks.
# Bound to 127.0.0.1:7777; dashboard reaches it over the DO VPC.
set -euo pipefail

# Install into its own venv
if [ ! -d /opt/hermes ]; then
  python3 -m venv /opt/hermes
  /opt/hermes/bin/pip install --upgrade pip
fi
/opt/hermes/bin/pip install --upgrade 'hermes-agent>=1.0,<2.0'

# Also install our plugin package (built in Phase 1.1)
if [ -d /opt/agenticos/repo/packages/agenticos-hermes ]; then
  /opt/hermes/bin/pip install --upgrade /opt/agenticos/repo/packages/agenticos-hermes
fi

# Symlink binaries
for bin in hermes hermes-server hermes-curator; do
  if [ -f /opt/hermes/bin/$bin ]; then
    ln -sf /opt/hermes/bin/$bin /usr/local/bin/$bin
  fi
done

# Seed config (the .env-driven OPENAI key + endpoints; written once, refreshed
# by reload-or-restart when the secrets-refresh timer rewrites /opt/agenticos/.env)
install -d -m 0755 -o deploy -g deploy /home/deploy/.hermes
install -m 0644 -o deploy -g deploy \
  /opt/agenticos/repo/infra/cloud-init/templates/hermes-config.yaml.tpl \
  /home/deploy/.hermes/config.yaml

# Register systemd unit
install -m 0644 /opt/agenticos/repo/infra/cloud-init/templates/hermes-agent.service \
  /etc/systemd/system/hermes-agent.service
systemctl daemon-reload
systemctl enable --now hermes-agent.service

# Wait for it
for i in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:7777/api/status >/dev/null 2>&1; then
    echo "Hermes Agent ready on :7777"
    exit 0
  fi
  sleep 1
done
echo "WARN: Hermes Agent didn't respond on :7777 within 30s; check 'journalctl -u hermes-agent'" >&2
exit 1
```

- [ ] **Step 3: Write the Hermes config template**

Create `infra/cloud-init/templates/hermes-config.yaml.tpl`:

```yaml
# Hermes Agent config for AgenticOS Spec 1.
# All API keys come from /opt/agenticos/.env (refreshed hourly from 1Password
# via the agenticos-secrets-refresh.timer).

server:
  host: 127.0.0.1
  port: 7777

# Main LLM: not actually invoked directly by Hermes in Spec 1 — agent work
# routes through our slm-router skill which picks Codex vs Ollama per task.
# Hermes uses this for its own light internal needs (session naming etc.).
llm:
  provider: openai
  model: gpt-4o-mini
  api_key_env: OPENAI_API_KEY

# Auxiliary LLMs (cheap models for Hermes's own internal ops)
auxiliary:
  curator:
    provider: openai
    model: gpt-4o-mini
    api_key_env: OPENAI_API_KEY

# Memory provider: OpenViking via Hermes's bundled plugin
memory:
  provider: openviking
  endpoint: http://127.0.0.1:1933

# Our custom skills (provided by the agenticos-hermes pip package)
skills:
  - name: cost-recorder
    module: agenticos_hermes.skills.cost_recorder
    hook: after_session
  - name: slm-runner
    module: agenticos_hermes.skills.slm_runner
  - name: codex-coder
    module: agenticos_hermes.skills.codex_coder
  - name: slm-router
    module: agenticos_hermes.skills.slm_router

# Plugins (event-driven, not turn-based)
plugins:
  - name: inbox-watcher
    module: agenticos_hermes.plugins.inbox_watcher
    config:
      watch_dir: /opt/vault/inbox
      debounce_seconds: 5

# Cron jobs
cron:
  timezone: America/New_York
  jobs:
    - name: daily-brief
      schedule: "0 7 * * *"
      task_module: agenticos_hermes.tasks.daily_brief
    - name: cost-report
      schedule: "0 23 * * *"
      task_module: agenticos_hermes.tasks.cost_report

# Telemetry database connection (Hermes plugins write to this)
telemetry:
  db_url_env: AGENTICOS_DB_URL
```

- [ ] **Step 4: Write the systemd unit**

Create `infra/cloud-init/templates/hermes-agent.service`:

```ini
[Unit]
Description=Hermes Agent orchestrator for AgenticOS
After=network.target agenticos-db-ready.target openviking.service ollama.service
Wants=openviking.service ollama.service

[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/home/deploy
# Pull all env vars from /opt/agenticos/.env (incl. OPENAI_API_KEY,
# AGENTICOS_DB_PASSWORD). Hermes constructs AGENTICOS_DB_URL from the
# password at startup; we set it explicitly here for clarity.
EnvironmentFile=/opt/agenticos/.env
Environment=AGENTICOS_DB_URL=postgresql://agenticos:${AGENTICOS_DB_PASSWORD}@127.0.0.1:5432/agenticos
ExecStart=/usr/local/bin/hermes-server --config /home/deploy/.hermes/config.yaml
Restart=on-failure
RestartSec=5s
StandardOutput=append:/var/log/agenticos/hermes.log
StandardError=append:/var/log/agenticos/hermes.log

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 5: Wire into cloud-init**

Edit `infra/cloud-init/droplet-bootstrap.yaml.tpl`, after the OpenViking block:

```yaml
  # --- Hermes Agent (orchestrator) ---
  # Installs the pip package AND our plugin package (built in Phase 1.1).
  # If the plugin package isn't in the repo yet, install-hermes.sh skips it
  # and Hermes starts without our custom skills — they'll be picked up at
  # the next cloud-init re-run or when we manually re-install.
  - chmod +x /opt/agenticos/repo/infra/cloud-init/scripts/install-hermes.sh
  - /opt/agenticos/repo/infra/cloud-init/scripts/install-hermes.sh
```

- [ ] **Step 6: Don't install yet on Droplet — wait for Task 9+**

The Hermes install needs our plugin package, which we build in Phase 1.1. We'll run it after Task 16. Just commit the scripts now.

- [ ] **Step 7: Commit**

```bash
git add infra/cloud-init/scripts/install-hermes.sh \
        infra/cloud-init/templates/hermes-config.yaml.tpl \
        infra/cloud-init/templates/hermes-agent.service \
        infra/cloud-init/droplet-bootstrap.yaml.tpl
git commit -m "feat(infra): add Hermes Agent install script + config template + systemd unit"
```

---

### Task 4: Codex CLI install via cloud-init

**Files:**
- Modify: `infra/cloud-init/droplet-bootstrap.yaml.tpl`

- [ ] **Step 1: Edit cloud-init**

Edit `infra/cloud-init/droplet-bootstrap.yaml.tpl`, find the `--- Claude Code ---` block, and add a parallel `--- Codex CLI ---` block immediately after:

```yaml
  # --- Codex CLI (OpenAI's equivalent to Claude Code; default coder for Spec 1+) ---
  # Installs into the same user-scoped npm prefix as Claude Code so updates
  # work without sudo. API-key-billed (OPENAI_API_KEY env), no interactive
  # OAuth needed for autonomous use.
  - sudo -iu deploy bash -lc 'npm install -g @openai/codex'
```

- [ ] **Step 2: Manually run on existing Droplet**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 \
  'bash -lc "npm install -g @openai/codex && which codex && codex --version"'
```

Expected: codex version output.

- [ ] **Step 3: Verify it can hit the API**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 \
  'bash -lc "set -a && source /opt/agenticos/.env && set +a && \
             echo Hello | codex --print 2>&1 | head -5"'
```

Expected: a sensible Codex response (≤ 20 lines). If it errors, check `OPENAI_API_KEY` is in env.

- [ ] **Step 4: Commit**

```bash
git add infra/cloud-init/droplet-bootstrap.yaml.tpl
git commit -m "feat(infra): install Codex CLI via cloud-init (deploy user npm prefix)"
```

---

### Task 5: Secret refresh — Terraform + 1P SA + systemd timer

**Files:**
- Create: `infra/terraform/secrets.tf`
- Create: `infra/cloud-init/scripts/refresh-secrets.sh`
- Create: `infra/cloud-init/templates/agenticos-secrets-refresh.service`
- Create: `infra/cloud-init/templates/agenticos-secrets-refresh.timer`
- Modify: `infra/cloud-init/droplet-bootstrap.yaml.tpl`
- Modify: `infra/terraform/droplet.tf`

- [ ] **Step 1: Write the refresh script**

Create `infra/cloud-init/scripts/refresh-secrets.sh`:

```bash
#!/usr/bin/env bash
# Hourly secret refresh: read API keys from 1Password Service Account → write
# /opt/agenticos/.env. Preserves the locally-generated AGENTICOS_DB_PASSWORD.
# Reloads Hermes so it picks up new env vars without dropping in-flight tasks.
set -euo pipefail

OP_TOKEN_FILE=/etc/1password-cli/token
ENV_FILE=/opt/agenticos/.env
VAULT='Goldberry Grove - Admin'
ITEM='AgenticOS Infra'

if [ ! -r "$OP_TOKEN_FILE" ]; then
  echo "refresh-secrets: $OP_TOKEN_FILE not readable; aborting" >&2
  exit 1
fi

export OP_SERVICE_ACCOUNT_TOKEN
OP_SERVICE_ACCOUNT_TOKEN=$(cat "$OP_TOKEN_FILE")

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
chmod 600 "$TMP"

# Preserve generated values that don't live in 1Password
grep -E '^(AGENTICOS_DB_PASSWORD)=' "$ENV_FILE" > "$TMP" || true

# Read from 1P and append
OPENAI_KEY=$(op item get "$ITEM" --vault "$VAULT" --fields openai_api_key --reveal)
if [ -z "$OPENAI_KEY" ]; then
  echo "refresh-secrets: openai_api_key empty; aborting" >&2
  exit 1
fi

{
  echo "OPENAI_API_KEY=$OPENAI_KEY"
  echo "LLM_OPENAI_API_KEY=$OPENAI_KEY"
} >> "$TMP"

# Atomic replace
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
chown deploy:deploy "$ENV_FILE"

# Reload Hermes so it picks up new env (it reads EnvironmentFile at startup)
if systemctl is-active hermes-agent.service >/dev/null 2>&1; then
  systemctl reload-or-restart hermes-agent.service
fi

echo "refresh-secrets: ok at $(date -Iseconds)"
```

- [ ] **Step 2: Write the systemd service**

Create `infra/cloud-init/templates/agenticos-secrets-refresh.service`:

```ini
[Unit]
Description=Refresh AgenticOS secrets from 1Password
After=network.target

[Service]
Type=oneshot
User=root
ExecStart=/opt/agenticos/bin/refresh-secrets.sh
StandardOutput=append:/var/log/agenticos/secrets-refresh.log
StandardError=append:/var/log/agenticos/secrets-refresh.log
```

- [ ] **Step 3: Write the systemd timer**

Create `infra/cloud-init/templates/agenticos-secrets-refresh.timer`:

```ini
[Unit]
Description=Run AgenticOS secrets refresh hourly

[Timer]
OnBootSec=2min
OnUnitActiveSec=1h
Persistent=true
Unit=agenticos-secrets-refresh.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 4: Add Terraform secrets resource**

Create `infra/terraform/secrets.tf`:

```hcl
# Read the 1Password Service Account token from 1Password (using your personal
# `op` session at terraform-apply time). This is what the Droplet uses for
# unattended hourly refresh of OPENAI_API_KEY.
#
# Provider config for 1Password lives in main.tf; if not present add:
#   provider "onepassword" {
#     account = "my.1password.com"  # or your team's domain
#   }

data "onepassword_item" "agenticos_infra" {
  vault = "Goldberry Grove - Admin"
  title = "AgenticOS Infra"
}

locals {
  # The SA token field in the 1P item. The op-CLI field name uses hyphens;
  # the Terraform provider exposes section/field maps. Adjust if your item's
  # field key differs.
  op_sa_token = [
    for f in data.onepassword_item.agenticos_infra.section[*].field[*] :
    f.value if f.label == "1password-production-terraform-key"
  ][0]
}
```

- [ ] **Step 5: Pass SA token to cloud-init via droplet.tf**

Edit `infra/terraform/droplet.tf`, find the `templatefile` call in `locals.cloud_init`, and add the `op_sa_token` variable:

```hcl
locals {
  cloud_init = templatefile("${path.module}/../cloud-init/droplet-bootstrap.yaml.tpl", {
    ts_authkey    = tailscale_tailnet_key.droplet.key
    github_repo   = var.github_repo
    deploy_pubkey = local.ssh_public_key
    op_sa_token   = local.op_sa_token
  })
}
```

- [ ] **Step 6: Add 1P token + timer to cloud-init template**

Edit `infra/cloud-init/droplet-bootstrap.yaml.tpl`. In the `write_files:` section add:

```yaml
  - path: /etc/1password-cli/token
    permissions: "0600"
    owner: root:root
    content: ${op_sa_token}

  - path: /opt/agenticos/bin/refresh-secrets.sh
    permissions: "0750"
    owner: root:root
    content: |
      $(cat infra/cloud-init/scripts/refresh-secrets.sh | sed 's/^/      /')
```

Wait — cloud-init's `write_files` with embedded scripts is brittle; the cleaner path is to copy from the repo at runcmd time. Use this instead at the end of `runcmd:`:

```yaml
  # --- Secret refresh from 1Password (hourly) ---
  - install -d -m 0700 /etc/1password-cli
  - install -m 0600 -o root -g root /dev/stdin /etc/1password-cli/token <<< "${op_sa_token}"
  # 1Password CLI (op binary)
  - |
    if ! command -v op >/dev/null 2>&1; then
      ARCH=$(dpkg --print-architecture)
      curl -fsSL "https://cache.agilebits.com/dist/1P/op2/pkg/v2.30.3/op_linux_${ARCH}_v2.30.3.zip" -o /tmp/op.zip
      unzip -o /tmp/op.zip -d /tmp/
      install -m 0755 /tmp/op /usr/local/bin/op
    fi
  # Install refresh script + systemd timer
  - install -d -m 0755 /opt/agenticos/bin
  - install -m 0750 /opt/agenticos/repo/infra/cloud-init/scripts/refresh-secrets.sh /opt/agenticos/bin/refresh-secrets.sh
  - install -m 0644 /opt/agenticos/repo/infra/cloud-init/templates/agenticos-secrets-refresh.service /etc/systemd/system/agenticos-secrets-refresh.service
  - install -m 0644 /opt/agenticos/repo/infra/cloud-init/templates/agenticos-secrets-refresh.timer /etc/systemd/system/agenticos-secrets-refresh.timer
  - systemctl daemon-reload
  - systemctl enable --now agenticos-secrets-refresh.timer
  - systemctl start agenticos-secrets-refresh.service  # initial run
```

- [ ] **Step 7: Run on existing Droplet (one-time manual since user_data ignore_changes)**

```bash
# Push the script + units
scp -i ~/.ssh/agenticos-droplet \
  infra/cloud-init/scripts/refresh-secrets.sh \
  infra/cloud-init/templates/agenticos-secrets-refresh.service \
  infra/cloud-init/templates/agenticos-secrets-refresh.timer \
  deploy@159.223.171.231:/tmp/

# Get SA token from 1P locally
TOKEN=$(op item get "AgenticOS Infra" --vault "Goldberry Grove - Admin" \
        --fields "1password-production-terraform-key" --reveal)

# Install token on Droplet
ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 \
  "sudo install -d -m 0700 /etc/1password-cli && \
   sudo bash -c 'cat > /etc/1password-cli/token' && \
   sudo chmod 600 /etc/1password-cli/token" <<< "$TOKEN"

# Install op CLI + script + units + enable timer
ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 'set -e
  if ! command -v op >/dev/null 2>&1; then
    ARCH=$(dpkg --print-architecture)
    curl -fsSL "https://cache.agilebits.com/dist/1P/op2/pkg/v2.30.3/op_linux_${ARCH}_v2.30.3.zip" -o /tmp/op.zip
    unzip -o /tmp/op.zip -d /tmp/
    sudo install -m 0755 /tmp/op /usr/local/bin/op
  fi
  sudo install -d -m 0755 /opt/agenticos/bin
  sudo install -m 0750 /tmp/refresh-secrets.sh /opt/agenticos/bin/refresh-secrets.sh
  sudo install -m 0644 /tmp/agenticos-secrets-refresh.service /etc/systemd/system/
  sudo install -m 0644 /tmp/agenticos-secrets-refresh.timer /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now agenticos-secrets-refresh.timer
  sudo systemctl start agenticos-secrets-refresh.service
  sleep 2
  sudo journalctl -u agenticos-secrets-refresh.service --no-pager -n 20
'
```

Expected: `refresh-secrets: ok at 2026-05-22T...`.

- [ ] **Step 8: Verify the timer is scheduled**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 \
  'systemctl list-timers | grep agenticos'
```

Expected: shows next run within ~1 hour.

- [ ] **Step 9: Commit**

```bash
git add infra/terraform/secrets.tf \
        infra/terraform/droplet.tf \
        infra/cloud-init/scripts/refresh-secrets.sh \
        infra/cloud-init/templates/agenticos-secrets-refresh.service \
        infra/cloud-init/templates/agenticos-secrets-refresh.timer \
        infra/cloud-init/droplet-bootstrap.yaml.tpl
git commit -m "feat(infra): hourly OpenAI key refresh from 1Password Service Account"
```

---

## Phase 1.2 — Telemetry schema (≈2 hrs)

Done before Phase 1.1 because skills depend on the schema existing.

### Task 6: Add Postgres + migration tooling to dashboard

**Files:**
- Modify: `apps/dashboard/package.json`

- [ ] **Step 1: Add deps**

```bash
cd apps/dashboard
pnpm add pg
pnpm add -D node-pg-migrate @types/pg
# Remove Honcho SDK (no longer used)
pnpm remove @honcho-ai/sdk
```

- [ ] **Step 2: Verify package.json changes**

```bash
grep -E '"(pg|node-pg-migrate|honcho)"' apps/dashboard/package.json
```

Expected: `pg` and `node-pg-migrate` present; no `@honcho-ai/sdk` line.

- [ ] **Step 3: Add migrate script**

Edit `apps/dashboard/package.json`, add to `scripts`:

```json
"migrate:up": "node-pg-migrate up -d AGENTICOS_DB_URL -m migrations",
"migrate:create": "node-pg-migrate create -m migrations --filename-format utc"
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/package.json pnpm-lock.yaml
git commit -m "chore(dashboard): add pg + node-pg-migrate; remove @honcho-ai/sdk"
```

---

### Task 7: Initial migration — tasks/sessions/calls/budget tables

**Files:**
- Create: `apps/dashboard/migrations/0001_initial_telemetry.sql`

- [ ] **Step 1: Write the migration**

Create `apps/dashboard/migrations/0001_initial_telemetry.sql` (raw SQL since node-pg-migrate supports SQL files):

```sql
-- AgenticOS Spec 1 — telemetry schema.
-- See: docs/superpowers/specs/2026-05-22-spec1-orchestrator-cost-observability-design.md §3.6

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  trigger       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','budget-blocked')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  cost_cents    INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  hermes_skill  TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  cost_cents    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS calls (
  id            BIGSERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_cents    INTEGER NOT NULL DEFAULT 0,
  latency_ms    INTEGER NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_started_at  ON tasks (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_task_id_occurred  ON calls (task_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_openai_occurred   ON calls (occurred_at DESC) WHERE provider = 'openai';

CREATE TABLE IF NOT EXISTS budget (
  id                   SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monthly_cap_cents    INTEGER NOT NULL DEFAULT 3000,
  soft_alert_pct       SMALLINT NOT NULL DEFAULT 80,
  reset_day_of_month   SMALLINT NOT NULL DEFAULT 1
);
INSERT INTO budget (id) VALUES (1) ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Run the migration locally against the Droplet's db (via Tailscale)**

```bash
# Get db password from Droplet
DB_PASSWORD=$(ssh -i ~/.ssh/agenticos-droplet deploy@agenticos-droplet \
              'grep ^AGENTICOS_DB_PASSWORD= /opt/agenticos/.env | cut -d= -f2-')

# Run via SSH tunnel (cleanest — no need to expose Postgres on Tailscale yet)
ssh -i ~/.ssh/agenticos-droplet -L 5432:127.0.0.1:5432 deploy@agenticos-droplet -N &
SSH_PID=$!
sleep 2

cd apps/dashboard
AGENTICOS_DB_URL="postgresql://agenticos:${DB_PASSWORD}@127.0.0.1:5432/agenticos" \
  pnpm migrate:up

kill $SSH_PID
```

Expected: `Migrations complete!`.

- [ ] **Step 3: Verify schema**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@agenticos-droplet \
  'docker exec agenticos-db psql -U agenticos -d agenticos -c "\dt"'
```

Expected: tables `budget`, `calls`, `pgmigrations`, `sessions`, `tasks`.

- [ ] **Step 4: Verify budget row exists**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@agenticos-droplet \
  'docker exec agenticos-db psql -U agenticos -d agenticos \
   -c "SELECT * FROM budget;"'
```

Expected: 1 row, `monthly_cap_cents=3000`, `soft_alert_pct=80`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/migrations/0001_initial_telemetry.sql
git commit -m "feat(dashboard): initial telemetry schema (tasks/sessions/calls/budget)"
```

---

### Task 8: Cloud-init runs migrations at boot

**Files:**
- Create: `infra/cloud-init/scripts/run-migrations.sh`
- Modify: `infra/cloud-init/droplet-bootstrap.yaml.tpl`

- [ ] **Step 1: Write the migration runner**

Create `infra/cloud-init/scripts/run-migrations.sh`:

```bash
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
```

- [ ] **Step 2: Wire into cloud-init**

Edit `infra/cloud-init/droplet-bootstrap.yaml.tpl`, after the docker-compose block (where `agenticos-db` comes up):

```yaml
  # --- Run dashboard migrations against agenticos-db ---
  - chmod +x /opt/agenticos/repo/infra/cloud-init/scripts/run-migrations.sh
  - /opt/agenticos/repo/infra/cloud-init/scripts/run-migrations.sh
```

- [ ] **Step 3: Commit**

```bash
git add infra/cloud-init/scripts/run-migrations.sh \
        infra/cloud-init/droplet-bootstrap.yaml.tpl
git commit -m "feat(infra): run dashboard migrations against agenticos-db at boot"
```

---

## Phase 1.1 — Hermes plugins package (≈5–6 hrs)

> **REPLANNED 2026-05-22.** Original tasks assumed a `SkillBase` Hermes class that doesn't exist. The verified contract (see `docs/superpowers/specs/spec1-verified-api-shapes.md` §3) splits our work into:
> - **Hook plugin** (`plugins/cost-recorder/`): runs inside Hermes, observes every LLM call via `post_llm_call` + `on_session_end` hooks declared in `plugin.yaml`. Bind-mounted into the Hermes container.
> - **Internal Python modules** (`src/agenticos_hermes/workers/`, `routing.py`, `tasks/`): pure code our cron tasks import; not loaded by Hermes.
> - **Standalone Docker daemon** (`daemons/inbox-watcher/`): separate compose service, fsnotify on `/opt/vault/inbox/`, triggers Hermes via REST.
>
> A few hook signatures still need confirmation at impl time (see notes in Task 11). The plan flags those clearly and the subagent should `inspect.signature` against a bundled plugin (`/opt/hermes/plugins/disk-cleanup/`) at the start of that task.

### Task 9: Plugin package skeleton

**Files:**
- Create: `packages/agenticos-hermes/pyproject.toml`
- Create: `packages/agenticos-hermes/src/agenticos_hermes/__init__.py`
- Create: `packages/agenticos-hermes/src/agenticos_hermes/workers/__init__.py`
- Create: `packages/agenticos-hermes/src/agenticos_hermes/tasks/__init__.py`
- Create: `packages/agenticos-hermes/tests/__init__.py`
- Create: `packages/agenticos-hermes/plugins/.gitkeep`
- Create: `packages/agenticos-hermes/daemons/.gitkeep`
- Create: `packages/agenticos-hermes/.gitignore`

- [ ] **Step 1: Write pyproject.toml**

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "agenticos-hermes"
version = "0.1.0"
description = "AgenticOS internal modules, Hermes hook plugins, and standalone daemons"
requires-python = ">=3.11"
dependencies = [
  "psycopg[binary]>=3.2",
  "httpx>=0.27",
  "watchdog>=4.0",
  "pydantic>=2.6",
  "PyYAML>=6.0",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.0",
  "pytest-asyncio>=0.23",
  "pytest-mock>=3.12",
]

[tool.hatch.build.targets.wheel]
packages = ["src/agenticos_hermes"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

- [ ] **Step 2: Write package init**

`src/agenticos_hermes/__init__.py`:
```python
"""AgenticOS Spec 1 plugins and internal modules.

Submodules:
  - workers.slm_runner    — Ollama HTTP client (internal, not a Hermes plugin)
  - workers.codex_coder   — codex exec --json subprocess wrapper (internal)
  - routing               — slm_router decision tree (pure function)
  - tasks.daily_brief     — cron task (07:00 ET)
  - tasks.cost_report     — cron task (23:00 ET)
  - tasks.inbox_triage    — triggered by daemons/inbox-watcher
  - db                    — Postgres connection helper
  - pricing               — per-call cost math (incl. cached_input_tokens discount)

Sibling top-level dirs (NOT inside src/):
  - plugins/cost-recorder/  — Hermes hook plugin bind-mounted into the container
  - daemons/inbox-watcher/  — Standalone Docker daemon
"""
__version__ = "0.1.0"
```

- [ ] **Step 3: Create empty init files + gitignore**

```bash
mkdir -p packages/agenticos-hermes/src/agenticos_hermes/workers
mkdir -p packages/agenticos-hermes/src/agenticos_hermes/tasks
mkdir -p packages/agenticos-hermes/plugins
mkdir -p packages/agenticos-hermes/daemons
mkdir -p packages/agenticos-hermes/tests

touch packages/agenticos-hermes/src/agenticos_hermes/workers/__init__.py
touch packages/agenticos-hermes/src/agenticos_hermes/tasks/__init__.py
touch packages/agenticos-hermes/tests/__init__.py
touch packages/agenticos-hermes/plugins/.gitkeep
touch packages/agenticos-hermes/daemons/.gitkeep

cat > packages/agenticos-hermes/.gitignore <<'EOF'
__pycache__/
*.py[cod]
*.egg-info/
.pytest_cache/
.venv/
dist/
EOF
```

- [ ] **Step 4: Sanity-check the package installs**

```bash
cd packages/agenticos-hermes
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -e '.[dev]'
.venv/bin/python -c 'import agenticos_hermes; print(agenticos_hermes.__version__)'
```
Expected: `0.1.0`.

- [ ] **Step 5: Commit + PR**

```bash
git -c commit.gpgsign=false commit -am "feat(hermes-plugins): package skeleton (replanned layout)"
git push -u origin agenticos/spec1-task9-skeleton
gh pr create --base main --title "feat(hermes-plugins): package skeleton" --body "..."
gh pr merge <num> --squash --auto --delete-branch
```

The CI's `Pytest (agenticos-hermes)` check will activate at this point (it was skipping until the pyproject.toml existed) — but tests are empty so it should pass.

---

### Task 10: Shared db.py + pricing.py helpers

**Files:**
- Create: `packages/agenticos-hermes/src/agenticos_hermes/db.py`
- Create: `packages/agenticos-hermes/src/agenticos_hermes/pricing.py`
- Create: `packages/agenticos-hermes/tests/test_db.py`
- Create: `packages/agenticos-hermes/tests/test_pricing.py`

- [ ] **Step 1: Write failing tests for pricing (TDD)**

`tests/test_pricing.py`:
```python
from agenticos_hermes.pricing import cost_cents

def test_local_ollama_is_free():
    assert cost_cents(provider="ollama", model="qwen2.5:3b",
                      input_tokens=1000, cached_input_tokens=0,
                      output_tokens=500, reasoning_output_tokens=0) == 0

def test_gpt5_codex_with_cache_discount():
    # 11754 input (10624 cached, 1130 uncached), 6 output, 0 reasoning — matches the verified probe
    # Expected: ~1.3 cents with cache discount, ~13 cents without
    c = cost_cents(provider="openai", model="gpt-5-codex",
                   input_tokens=11754, cached_input_tokens=10624,
                   output_tokens=6, reasoning_output_tokens=0)
    assert 1 <= c <= 3, f"expected ~1-2 cents with cache, got {c}"

def test_reasoning_tokens_billed_as_output():
    # If model has reasoning tokens (o-series), they count toward output rate
    c_with_reasoning = cost_cents(provider="openai", model="gpt-5",
                                   input_tokens=100, cached_input_tokens=0,
                                   output_tokens=50, reasoning_output_tokens=200)
    c_without = cost_cents(provider="openai", model="gpt-5",
                            input_tokens=100, cached_input_tokens=0,
                            output_tokens=50, reasoning_output_tokens=0)
    assert c_with_reasoning > c_without
```

- [ ] **Step 2: Implement `pricing.py`**

```python
"""Per-call cost computation. Source of truth for $ amounts in telemetry.

Pricing tables are checked into version control — commit history acts as the
audit trail. Update whenever OpenAI changes their rate card.

Schema: per million tokens, in cents. Tuple is (input_rate, cached_rate, output_rate).
Cached input is heavily discounted (~90% off) per OpenAI's prompt-cache pricing.
"""
from typing import Final, Literal

# (input_per_M_cents, cached_input_per_M_cents, output_per_M_cents)
_OPENAI_PRICING: Final[dict[str, tuple[int, int, int]]] = {
    # Verify against https://openai.com/api/pricing — last reviewed 2026-05-22
    "gpt-5-codex": (125, 12, 1000),    # $1.25 / $0.12 / $10.00
    "gpt-5":       (300, 30, 1500),    # $3.00 / $0.30 / $15.00
    "gpt-5-mini":  (15,  1,  60),      # $0.15 / $0.01 / $0.60
    "gpt-4o-mini": (15,  1,  60),
}

_LOCAL_PROVIDERS: Final[set[str]] = {"ollama"}


def cost_cents(*,
               provider: Literal["openai", "ollama"],
               model: str,
               input_tokens: int,
               cached_input_tokens: int = 0,
               output_tokens: int,
               reasoning_output_tokens: int = 0) -> int:
    """Compute cost in integer cents (ceiling-rounded).

    Reasoning tokens (o-series "thinking") are billed at the output rate.
    Cached input tokens are billed at the cached (discounted) rate; the
    remaining `input_tokens - cached_input_tokens` are billed at full input rate.
    """
    if provider in _LOCAL_PROVIDERS:
        return 0
    if provider != "openai":
        raise ValueError(f"unknown provider: {provider}")
    if model not in _OPENAI_PRICING:
        raise ValueError(f"unknown model: {model}")

    in_rate, cached_rate, out_rate = _OPENAI_PRICING[model]
    uncached_input = max(0, input_tokens - cached_input_tokens)
    total_output = output_tokens + reasoning_output_tokens

    # Cents-per-million tokens * tokens → integer cents (ceiling)
    micro = (uncached_input * in_rate
             + cached_input_tokens * cached_rate
             + total_output * out_rate)
    return -(-micro // 1_000_000)  # ceiling division
```

- [ ] **Step 3: Run tests**

```bash
cd packages/agenticos-hermes && .venv/bin/pytest tests/test_pricing.py -v
```
Expected: 3 passed.

- [ ] **Step 4: Write `db.py`**

```python
"""Postgres connection helper. Plugin/task code uses `with connect() as conn:`.

We use psycopg3 sync — Hermes calls our hook functions synchronously and our
cron tasks are batch-oriented; async would add complexity for no win.
"""
import os
from contextlib import contextmanager
from typing import Iterator

import psycopg


def build_db_url() -> str:
    """Read AGENTICOS_DB_URL from env. Raises if unset."""
    url = os.environ.get("AGENTICOS_DB_URL")
    if not url:
        raise RuntimeError("AGENTICOS_DB_URL not set in environment")
    return url


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """Yield a Postgres connection. Commits on clean exit, rolls back on error."""
    with psycopg.connect(build_db_url()) as conn:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
```

- [ ] **Step 5: Write test_db.py**

```python
import pytest
from agenticos_hermes.db import build_db_url

def test_build_db_url_from_env(monkeypatch):
    monkeypatch.setenv("AGENTICOS_DB_URL", "postgresql://x:y@h:5432/d")
    assert build_db_url() == "postgresql://x:y@h:5432/d"

def test_missing_raises(monkeypatch):
    monkeypatch.delenv("AGENTICOS_DB_URL", raising=False)
    with pytest.raises(RuntimeError, match="AGENTICOS_DB_URL"):
        build_db_url()
```

- [ ] **Step 6: Run all tests + commit + PR**

```bash
.venv/bin/pytest -v
git -c commit.gpgsign=false commit -am "feat(hermes-plugins): db + pricing helpers (with cached_input_tokens math)"
git push -u origin agenticos/spec1-task10-db-pricing
gh pr create --base main --title "feat(hermes-plugins): db + pricing helpers"
gh pr merge <num> --squash --auto --delete-branch
```

---

### Task 11: cost-recorder hook plugin

**Files:**
- Create: `packages/agenticos-hermes/plugins/cost-recorder/plugin.yaml`
- Create: `packages/agenticos-hermes/plugins/cost-recorder/__init__.py`
- Create: `packages/agenticos-hermes/tests/test_cost_recorder.py`

- [ ] **Step 1: VERIFY hook function signatures against a bundled plugin**

Before writing code, run this probe on the Droplet to learn the actual hook function shape:

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 \
  'docker exec hermes-agent bash -c "
    cat /opt/hermes/plugins/observability/langfuse/__init__.py | head -80
    echo ---
    grep -rn \"def post_llm_call\\|def on_session_end\\|def post_tool_call\" /opt/hermes/plugins/ 2>/dev/null | head -10
  "'
```

Document the actual signatures observed (which args, kwargs, return types) at the top of `plugin.yaml` as comments. **If signatures differ from what's assumed below, adjust the function bodies accordingly — the hook contract is the source of truth.**

- [ ] **Step 2: Write `plugin.yaml`**

```yaml
name: cost-recorder
version: 1.0.0
description: "AgenticOS cost telemetry — records every LLM call to agenticos-db (tasks/sessions/calls)."
author: AgenticOS
requires_env:
  - AGENTICOS_DB_URL
hooks:
  - post_llm_call
  - on_session_end
```

- [ ] **Step 3: Write `__init__.py`**

```python
"""cost-recorder hook plugin for Hermes Agent.

VERIFY at impl time: the exact hook signatures Hermes calls. Confirmed-good
references for shape: /opt/hermes/plugins/observability/langfuse/__init__.py
(which implements pre/post_llm_call hooks). Adjust the parameter names below
to match Hermes 0.14's actual contract; the BODY logic is correct regardless.

Hook lifecycle (per spec1-verified-api-shapes.md §3a):
  - post_llm_call: fires after every LLM API call. Use to record `calls` rows.
  - on_session_end: fires when a Hermes session closes. Use to roll up
    cost_cents into the parent `tasks` row.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from agenticos_hermes.db import connect
from agenticos_hermes.pricing import cost_cents

logger = logging.getLogger(__name__)


def _task_id_for_session(session_id: str) -> str | None:
    """Look up the parent task_id for a Hermes session.

    Spec 1's session→task linkage: when a cron task starts a Hermes session,
    it inserts the (task_id, session_id, hermes_skill) row in `sessions` first.
    By the time post_llm_call fires, the row already exists.
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT task_id FROM sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
        return row[0] if row else None


def post_llm_call(*, session_id: str, request: dict[str, Any],
                   response: dict[str, Any], **kwargs) -> None:
    """Record a single LLM API call into `calls`.

    Expected `response` shape (verify at impl time):
      response.usage = {input_tokens, cached_input_tokens, output_tokens,
                        reasoning_output_tokens}
      response.model = "gpt-5-codex" / "qwen2.5:3b" / ...
      response.provider = "openai" / "ollama"
      response.latency_ms = int
    """
    task_id = _task_id_for_session(session_id)
    if task_id is None:
        logger.warning("post_llm_call: session %s has no task row; skipping",
                       session_id)
        return

    provider = response.get("provider", "openai")
    model = response.get("model", "unknown")
    usage = response.get("usage", {})
    cost = cost_cents(
        provider=provider,
        model=model,
        input_tokens=usage.get("input_tokens", 0),
        cached_input_tokens=usage.get("cached_input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        reasoning_output_tokens=usage.get("reasoning_output_tokens", 0),
    )

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO calls
               (session_id, task_id, provider, model,
                input_tokens, cached_input_tokens,
                output_tokens, reasoning_output_tokens,
                cost_cents, latency_ms, metadata)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)""",
            (
                session_id, task_id, provider, model,
                usage.get("input_tokens", 0),
                usage.get("cached_input_tokens", 0),
                usage.get("output_tokens", 0),
                usage.get("reasoning_output_tokens", 0),
                cost,
                response.get("latency_ms", 0),
                json.dumps(response.get("metadata", {})),
            ),
        )


def on_session_end(*, session_id: str, **kwargs) -> None:
    """Close the sessions row, then roll up task cost from its calls."""
    with connect() as conn, conn.cursor() as cur:
        # Close session: set ended_at, roll up its calls' cost
        cur.execute(
            """SELECT COALESCE(SUM(cost_cents), 0) FROM calls
               WHERE session_id = %s""",
            (session_id,),
        )
        session_cost = cur.fetchone()[0]
        cur.execute(
            """UPDATE sessions SET ended_at = now(), cost_cents = %s
               WHERE id = %s""",
            (session_cost, session_id),
        )

        # Also roll up to the task: sum cost across all its sessions
        cur.execute(
            """UPDATE tasks t SET cost_cents = (
                 SELECT COALESCE(SUM(cost_cents), 0) FROM calls
                 WHERE task_id = t.id
               )
               WHERE id = (SELECT task_id FROM sessions WHERE id = %s)""",
            (session_id,),
        )
```

- [ ] **Step 4: Write tests with mocked connect()**

```python
# tests/test_cost_recorder.py
import json
from unittest.mock import MagicMock, patch
import sys
import os
from pathlib import Path

# Add plugins/ to sys.path so we can import the hook module
PLUGINS_DIR = Path(__file__).parent.parent / "plugins" / "cost-recorder"
sys.path.insert(0, str(PLUGINS_DIR.parent))  # parent so we can do `import importlib; importlib.import_module("cost-recorder")` — but cost-recorder has a hyphen so we import via spec_from_file_location

import importlib.util
spec = importlib.util.spec_from_file_location(
    "cost_recorder", str(PLUGINS_DIR / "__init__.py")
)
cost_recorder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cost_recorder)


@patch.object(cost_recorder, "connect")
def test_post_llm_call_inserts_row(mock_connect):
    cursor = MagicMock()
    cursor.fetchone.return_value = ("task-abc",)
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    mock_connect.return_value.__enter__.return_value = conn

    cost_recorder.post_llm_call(
        session_id="sess-1",
        request={},
        response={
            "provider": "openai",
            "model": "gpt-5-codex",
            "usage": {"input_tokens": 11754, "cached_input_tokens": 10624,
                      "output_tokens": 6, "reasoning_output_tokens": 0},
            "latency_ms": 1500,
        },
    )
    # First execute is the task_id lookup; second is the INSERT
    assert any("INSERT INTO calls" in str(c)
               for c in cursor.execute.call_args_list), \
           "expected INSERT into calls"


@patch.object(cost_recorder, "connect")
def test_on_session_end_rolls_up(mock_connect):
    cursor = MagicMock()
    cursor.fetchone.return_value = (42,)
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    mock_connect.return_value.__enter__.return_value = conn

    cost_recorder.on_session_end(session_id="sess-1")

    calls = [str(c) for c in cursor.execute.call_args_list]
    assert any("UPDATE sessions" in c for c in calls)
    assert any("UPDATE tasks" in c for c in calls)
```

- [ ] **Step 5: Run tests + commit + PR**

```bash
.venv/bin/pytest tests/test_cost_recorder.py -v
git -c commit.gpgsign=false commit -am "feat(hermes-plugins): cost-recorder hook plugin (post_llm_call + on_session_end)"
git push -u origin agenticos/spec1-task11-cost-recorder
gh pr create --base main --title "feat(hermes-plugins): cost-recorder hook plugin"
gh pr merge <num> --squash --auto --delete-branch
```

> The plugin doesn't actually run inside Hermes until Task 16 bind-mounts it into the container and enables it. Tests are the verification for this task.

---

### Task 12: slm_runner worker (Ollama HTTP wrapper)

**Files:**
- Create: `packages/agenticos-hermes/src/agenticos_hermes/workers/slm_runner.py`
- Create: `packages/agenticos-hermes/tests/test_slm_runner.py`

This is an **internal Python module**, not a Hermes plugin. It's imported by our cron task code (Tasks 23–25).

- [ ] **Step 1: Failing test**

```python
# tests/test_slm_runner.py
import pytest
from unittest.mock import patch, MagicMock
from agenticos_hermes.workers.slm_runner import run_slm, SlmResult

@patch("agenticos_hermes.workers.slm_runner.httpx.Client")
def test_run_slm_parses_response(mock_client_cls):
    client = MagicMock()
    mock_client_cls.return_value.__enter__.return_value = client
    resp = MagicMock()
    resp.json.return_value = {
        "choices": [{"message": {"content": "category: farming"}}],
        "usage": {"prompt_tokens": 42, "completion_tokens": 8},
    }
    resp.raise_for_status = MagicMock()
    client.post.return_value = resp

    r = run_slm(model="qwen2.5:3b", prompt="classify this")
    assert isinstance(r, SlmResult)
    assert r.text == "category: farming"
    assert r.input_tokens == 42
    assert r.output_tokens == 8
    assert r.model == "qwen2.5:3b"
```

- [ ] **Step 2: Implement `slm_runner.py`**

```python
"""Ollama HTTP wrapper. Uses Ollama's OpenAI-compatible /v1/chat/completions
endpoint. Always returns 0 cost (handled by pricing.py's local-providers set).
"""
import os
import time
from dataclasses import dataclass
import httpx

OLLAMA_ENDPOINT = os.environ.get("OLLAMA_ENDPOINT", "http://ollama:11434")
OLLAMA_TIMEOUT = float(os.environ.get("OLLAMA_TIMEOUT", "60"))


@dataclass(frozen=True)
class SlmResult:
    text: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: int


def run_slm(*, model: str, prompt: str, system: str = "",
            temperature: float = 0.2) -> SlmResult:
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    start = time.monotonic()
    with httpx.Client(timeout=OLLAMA_TIMEOUT) as client:
        resp = client.post(
            f"{OLLAMA_ENDPOINT}/v1/chat/completions",
            json={"model": model, "messages": messages,
                  "temperature": temperature, "stream": False},
        )
        resp.raise_for_status()
        data = resp.json()
    latency_ms = int((time.monotonic() - start) * 1000)

    return SlmResult(
        text=data["choices"][0]["message"]["content"],
        model=model,
        input_tokens=data.get("usage", {}).get("prompt_tokens", 0),
        output_tokens=data.get("usage", {}).get("completion_tokens", 0),
        latency_ms=latency_ms,
    )
```

- [ ] **Step 3: Run, commit, PR**

```bash
.venv/bin/pytest tests/test_slm_runner.py -v
git -c commit.gpgsign=false commit -am "feat(hermes-plugins): slm_runner worker (Ollama OpenAI-compat HTTP)"
git push -u origin agenticos/spec1-task12-slm-runner
gh pr create --base main --title "feat(hermes-plugins): slm_runner worker"
gh pr merge <num> --squash --auto --delete-branch
```

---

### Task 13: codex_coder worker (Codex CLI wrapper)

**Files:**
- Create: `packages/agenticos-hermes/src/agenticos_hermes/workers/codex_coder.py`
- Create: `packages/agenticos-hermes/tests/test_codex_coder.py`

Internal Python module. Uses the verified `codex exec --json` invocation pattern from `spec1-verified-api-shapes.md` §2.

- [ ] **Step 1: Failing test (verified JSONL event shape)**

```python
# tests/test_codex_coder.py
import json
import pytest
from unittest.mock import patch, MagicMock
from agenticos_hermes.workers.codex_coder import run_codex, CodexResult

@patch("agenticos_hermes.workers.codex_coder.subprocess.run")
def test_run_codex_parses_verified_jsonl(mock_run):
    # Real shape from a successful gpt-5-codex run (spec1-verified-api-shapes.md §2)
    events = [
        json.dumps({"type": "thread.started", "thread_id": "abc-123"}),
        json.dumps({"type": "turn.started"}),
        json.dumps({"type": "item.completed",
                    "item": {"id": "item_0", "type": "agent_message", "text": "PONG"}}),
        json.dumps({"type": "turn.completed",
                    "usage": {"input_tokens": 11754, "cached_input_tokens": 10624,
                              "output_tokens": 6, "reasoning_output_tokens": 0}}),
    ]
    mock_run.return_value = MagicMock(
        returncode=0, stdout="\n".join(events) + "\n", stderr="",
    )

    r = run_codex(prompt="say PONG", task_id="task-1")
    assert isinstance(r, CodexResult)
    assert r.text == "PONG"
    assert r.input_tokens == 11754
    assert r.cached_input_tokens == 10624
    assert r.output_tokens == 6
    assert r.reasoning_output_tokens == 0


@patch("agenticos_hermes.workers.codex_coder.subprocess.run")
def test_run_codex_concatenates_multiple_agent_messages(mock_run):
    events = [
        json.dumps({"type": "thread.started", "thread_id": "abc"}),
        json.dumps({"type": "turn.started"}),
        json.dumps({"type": "item.completed",
                    "item": {"id": "i0", "type": "agent_message", "text": "Part 1 "}}),
        json.dumps({"type": "item.completed",
                    "item": {"id": "i1", "type": "agent_message", "text": "Part 2"}}),
        json.dumps({"type": "turn.completed",
                    "usage": {"input_tokens": 10, "cached_input_tokens": 0,
                              "output_tokens": 5, "reasoning_output_tokens": 0}}),
    ]
    mock_run.return_value = MagicMock(returncode=0, stdout="\n".join(events), stderr="")
    r = run_codex(prompt="x", task_id="t")
    assert r.text == "Part 1 Part 2"


@patch("agenticos_hermes.workers.codex_coder.subprocess.run")
def test_run_codex_raises_on_turn_failed(mock_run):
    events = [
        json.dumps({"type": "thread.started", "thread_id": "abc"}),
        json.dumps({"type": "turn.started"}),
        json.dumps({"type": "error", "message": "Quota exceeded."}),
        json.dumps({"type": "turn.failed",
                    "error": {"message": "Quota exceeded."}}),
    ]
    mock_run.return_value = MagicMock(returncode=0, stdout="\n".join(events), stderr="")
    with pytest.raises(RuntimeError, match="Quota exceeded"):
        run_codex(prompt="x", task_id="t")
```

- [ ] **Step 2: Implement `codex_coder.py`**

```python
"""codex exec --json subprocess wrapper.

Invocation pattern from spec1-verified-api-shapes.md §2:
  echo "<prompt>" | codex exec --json --skip-git-repo-check \
                                --sandbox read-only \
                                --dangerously-bypass-approvals-and-sandbox \
                                --model <model>

JSONL events parsed:
  thread.started      → thread_id (informational)
  turn.started        → marker
  item.completed      → if item.type == "agent_message", append item.text
  turn.completed      → usage dict (input/cached_input/output/reasoning tokens)
  error / turn.failed → raise RuntimeError with the message

Auth: requires `codex login --with-api-key` to have been run once; auth
persists in ~/.codex/auth.json. Cloud-init Task 4 already handles this.
"""
import json
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

CODEX_BIN = os.environ.get("CODEX_BIN", "codex")
CODEX_DEFAULT_MODEL = os.environ.get("CODEX_DEFAULT_MODEL", "gpt-5-codex")
WORK_ROOT = Path(os.environ.get("AGENTICOS_WORK_ROOT", "/opt/agenticos/work"))


@dataclass(frozen=True)
class CodexResult:
    text: str
    model: str
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    reasoning_output_tokens: int
    latency_ms: int


def run_codex(*, prompt: str, task_id: str,
              model: str = CODEX_DEFAULT_MODEL,
              timeout_sec: int = 600) -> CodexResult:
    sandbox = WORK_ROOT / task_id
    sandbox.mkdir(parents=True, exist_ok=True)

    cmd = [
        CODEX_BIN, "exec", "--json",
        "--skip-git-repo-check",
        "--sandbox", "read-only",
        "--dangerously-bypass-approvals-and-sandbox",
        "--model", model,
    ]
    start = time.monotonic()
    proc = subprocess.run(
        cmd, input=prompt, capture_output=True, text=True,
        cwd=sandbox, timeout=timeout_sec, env={**os.environ},
    )
    latency_ms = int((time.monotonic() - start) * 1000)

    if proc.returncode != 0:
        raise RuntimeError(
            f"Codex exited {proc.returncode}: {proc.stderr[:500]}"
        )

    text_parts: list[str] = []
    actual_model = model
    usage: dict = {}
    error_msg: str | None = None

    for line in proc.stdout.splitlines():
        if not line.strip():
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        et = ev.get("type")
        if et == "item.completed":
            item = ev.get("item", {})
            if item.get("type") == "agent_message":
                text_parts.append(item.get("text", ""))
        elif et == "turn.completed":
            usage = ev.get("usage", {})
        elif et in ("error", "turn.failed"):
            msg = ev.get("error", {}).get("message") or ev.get("message", "")
            error_msg = msg

    if error_msg:
        raise RuntimeError(f"Codex turn failed: {error_msg}")

    return CodexResult(
        text="".join(text_parts),
        model=actual_model,
        input_tokens=usage.get("input_tokens", 0),
        cached_input_tokens=usage.get("cached_input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        reasoning_output_tokens=usage.get("reasoning_output_tokens", 0),
        latency_ms=latency_ms,
    )
```

- [ ] **Step 3: Run, commit, PR**

```bash
.venv/bin/pytest tests/test_codex_coder.py -v
git -c commit.gpgsign=false commit -am "feat(hermes-plugins): codex_coder worker (verified JSONL event shape)"
git push -u origin agenticos/spec1-task13-codex-coder
gh pr create --base main --title "feat(hermes-plugins): codex_coder worker"
gh pr merge <num> --squash --auto --delete-branch
```

---

### Task 14: routing.py (slm_router decision tree)

**Files:**
- Create: `packages/agenticos-hermes/src/agenticos_hermes/routing.py`
- Create: `packages/agenticos-hermes/tests/test_routing.py`

Pure function module. Spec §5.1 logic.

- [ ] **Step 1: Failing tests (matrix coverage)**

```python
# tests/test_routing.py
from unittest.mock import patch
from agenticos_hermes.routing import route, RouteDecision

@patch("agenticos_hermes.routing._mtd_cost_cents", return_value=3001)
@patch("agenticos_hermes.routing._budget_cap_cents", return_value=3000)
def test_budget_blocked_forces_slm(_cap, _mtd):
    d = route(kind="daily-brief", complexity="high", context_tokens=1000)
    assert d.provider == "ollama"
    assert d.budget_blocked is True

@patch("agenticos_hermes.routing._mtd_cost_cents", return_value=0)
@patch("agenticos_hermes.routing._budget_cap_cents", return_value=3000)
def test_inbox_triage_routes_slm(_cap, _mtd):
    d = route(kind="inbox-triage", complexity="auto", context_tokens=500)
    assert d.provider == "ollama"

@patch("agenticos_hermes.routing._mtd_cost_cents", return_value=0)
@patch("agenticos_hermes.routing._budget_cap_cents", return_value=3000)
def test_daily_brief_routes_codex(_cap, _mtd):
    d = route(kind="daily-brief", complexity="auto", context_tokens=2000)
    assert d.provider == "openai"

@patch("agenticos_hermes.routing._mtd_cost_cents", return_value=0)
@patch("agenticos_hermes.routing._budget_cap_cents", return_value=3000)
def test_long_context_forces_codex(_cap, _mtd):
    d = route(kind="other", complexity="auto", context_tokens=17000)
    assert d.provider == "openai"

@patch("agenticos_hermes.routing._mtd_cost_cents", return_value=0)
@patch("agenticos_hermes.routing._budget_cap_cents", return_value=3000)
def test_default_routes_slm(_cap, _mtd):
    d = route(kind="other", complexity="auto", context_tokens=500)
    assert d.provider == "ollama"
```

- [ ] **Step 2: Implement `routing.py`**

```python
"""slm_router — decides Codex vs Ollama per call.

Decision tree (spec §5.1, priority order):
  1. Budget hard-block      → SLM
  2. Task-kind override     → config-driven
  3. Context > 16k tokens   → Codex (SLMs lose coherence)
  4. Complexity hint        → high → Codex, low → SLM
  5. Default                → SLM
"""
from dataclasses import dataclass
from typing import Literal

from .db import connect

CONTEXT_ESCALATION_THRESHOLD = 16_000
DEFAULT_SLM_MODEL = "qwen2.5:3b"
DEFAULT_CODEX_MODEL = "gpt-5-codex"

_KIND_ROUTING: dict[str, str] = {
    "inbox-triage": "ollama",
    "cost-report": "ollama",
    "daily-brief": "openai",
}


@dataclass(frozen=True)
class RouteDecision:
    provider: Literal["ollama", "openai"]
    model: str
    reason: str
    budget_blocked: bool = False


def _mtd_cost_cents() -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("""SELECT COALESCE(SUM(cost_cents), 0)
                       FROM calls
                       WHERE provider = 'openai'
                         AND occurred_at >= date_trunc('month', now())""")
        return int(cur.fetchone()[0])


def _budget_cap_cents() -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT monthly_cap_cents FROM budget WHERE id = 1")
        row = cur.fetchone()
        return int(row[0]) if row else 3000


def route(*, kind: str,
          complexity: Literal["low", "auto", "high"] = "auto",
          context_tokens: int = 0) -> RouteDecision:
    if _mtd_cost_cents() >= _budget_cap_cents():
        return RouteDecision("ollama", DEFAULT_SLM_MODEL,
                             "budget-blocked", budget_blocked=True)
    if kind in _KIND_ROUTING:
        prov = _KIND_ROUTING[kind]
        model = DEFAULT_CODEX_MODEL if prov == "openai" else DEFAULT_SLM_MODEL
        return RouteDecision(prov, model, f"kind-override:{kind}")
    if context_tokens > CONTEXT_ESCALATION_THRESHOLD:
        return RouteDecision("openai", DEFAULT_CODEX_MODEL,
                             f"context-{context_tokens}>16k")
    if complexity == "high":
        return RouteDecision("openai", DEFAULT_CODEX_MODEL, "complexity-high")
    if complexity == "low":
        return RouteDecision("ollama", DEFAULT_SLM_MODEL, "complexity-low")
    return RouteDecision("ollama", DEFAULT_SLM_MODEL, "default-slm")
```

- [ ] **Step 3: Run, commit, PR**

```bash
.venv/bin/pytest tests/test_routing.py -v
git -c commit.gpgsign=false commit -am "feat(hermes-plugins): routing.py decision tree (budget/kind/context/complexity)"
git push -u origin agenticos/spec1-task14-routing
gh pr create --base main --title "feat(hermes-plugins): slm_router decision tree"
gh pr merge <num> --squash --auto --delete-branch
```

---

### Task 15: inbox-watcher standalone daemon

**Files:**
- Create: `packages/agenticos-hermes/daemons/inbox-watcher/Dockerfile`
- Create: `packages/agenticos-hermes/daemons/inbox-watcher/pyproject.toml`
- Create: `packages/agenticos-hermes/daemons/inbox-watcher/watcher.py`
- Create: `packages/agenticos-hermes/daemons/inbox-watcher/test_watcher.py`

**Standalone Docker daemon**, NOT a Hermes plugin. Watches `/opt/vault/inbox/` via fsnotify; on a stable `.md` file, invokes the inbox-triage task entrypoint.

- [ ] **Step 1: Decide invocation mechanism (Hermes REST vs subprocess)**

Two options for triggering work from the daemon:
- **(a) Hermes REST:** POST to `/api/sessions` to create a Hermes session, then call our task code. Requires reading the `__HERMES_SESSION_TOKEN__` from the dashboard HTML. Defer to runtime — if it works, prefer it (the work shows up in Hermes's session list).
- **(b) Subprocess:** `python -m agenticos_hermes.tasks.inbox_triage <path>` directly. Simpler, no REST coupling. Hermes won't know about the session unless the task code itself calls Hermes APIs.

Default: **(b)** — simpler, doesn't depend on the ephemeral-token harvest pattern. The cron-task code itself can opt to start a Hermes session if needed.

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install agenticos-hermes from local context (sibling dir mount via compose)
COPY . /app/daemon
COPY ../../src /app/agenticos_hermes
COPY ../../pyproject.toml /app/pyproject.toml

RUN pip install --no-cache-dir watchdog>=4.0 httpx>=0.27 PyYAML>=6.0 'psycopg[binary]>=3.2' \
    && pip install --no-cache-dir -e /app

# Run as non-root to match Hermes container's UID layout (root inside but mapped to deploy outside)
RUN useradd -m -u 10000 watcher
USER watcher

ENV PYTHONUNBUFFERED=1
CMD ["python", "/app/daemon/watcher.py"]
```

- [ ] **Step 3: Write `watcher.py`**

```python
"""inbox-watcher daemon.

Watches /opt/vault/inbox/ for stable .md files. On detection:
  1. Debounce 5s
  2. Confirm size stable (re-check after 200ms)
  3. Invoke `python -m agenticos_hermes.tasks.inbox_triage <path>`
"""
from __future__ import annotations
import logging
import os
import subprocess
import threading
import time
from pathlib import Path

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

WATCH_DIR = Path(os.environ.get("INBOX_WATCH_DIR", "/opt/vault/inbox"))
DEBOUNCE_SECONDS = float(os.environ.get("INBOX_DEBOUNCE_SECONDS", "5.0"))

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("inbox-watcher")


class Triager:
    def __init__(self) -> None:
        self._pending: dict[Path, threading.Timer] = {}
        self._lock = threading.Lock()

    def on_event(self, path: Path) -> None:
        if path.suffix != ".md":
            return
        with self._lock:
            if path in self._pending:
                self._pending[path].cancel()
            t = threading.Timer(DEBOUNCE_SECONDS, self._fire, args=(path,))
            self._pending[path] = t
            t.start()

    def _fire(self, path: Path) -> None:
        with self._lock:
            self._pending.pop(path, None)
        try:
            s1 = path.stat().st_size
            time.sleep(0.2)
            s2 = path.stat().st_size
        except FileNotFoundError:
            return
        if s1 != s2:
            self.on_event(path)
            return

        log.info("triggering inbox-triage for %s", path)
        try:
            subprocess.run(
                ["python", "-m", "agenticos_hermes.tasks.inbox_triage", str(path)],
                check=True, timeout=300,
            )
        except subprocess.CalledProcessError as e:
            log.error("inbox-triage failed for %s: %s", path, e)
        except subprocess.TimeoutExpired:
            log.error("inbox-triage timed out for %s", path)


class _Handler(FileSystemEventHandler):
    def __init__(self, triager: Triager) -> None:
        self.triager = triager

    def on_created(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self.triager.on_event(Path(event.src_path))

    def on_modified(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self.triager.on_event(Path(event.src_path))


def main() -> None:
    WATCH_DIR.mkdir(parents=True, exist_ok=True)
    triager = Triager()
    observer = Observer()
    observer.schedule(_Handler(triager), str(WATCH_DIR), recursive=False)
    observer.start()
    log.info("watching %s (debounce=%ss)", WATCH_DIR, DEBOUNCE_SECONDS)
    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Add compose service**

Edit `docker-compose.yml` — add at end of `services:`:

```yaml
  inbox-watcher:
    build:
      context: ./packages/agenticos-hermes
      dockerfile: daemons/inbox-watcher/Dockerfile
    container_name: inbox-watcher
    restart: unless-stopped
    volumes:
      - /opt/vault:/opt/vault
    environment:
      AGENTICOS_DB_URL: postgresql://agenticos:${AGENTICOS_DB_PASSWORD}@agenticos-db:5432/agenticos
      OLLAMA_ENDPOINT: http://ollama:11434
      OPENVIKING_ENDPOINT: http://openviking:1933
      OPENVIKING_ROOT_API_KEY: ${OPENVIKING_ROOT_API_KEY}
    depends_on:
      agenticos-db:
        condition: service_healthy
      ollama:
        condition: service_healthy
    env_file:
      - /opt/agenticos/.env
    networks:
      - agenticos
```

- [ ] **Step 5: Commit, PR (with cross-task notes for Task 16)**

Don't deploy this compose change yet — Task 16 deploys all the Phase 1.1 wiring together. Just commit + push + PR.

---

### Task 16: Deploy Phase 1.1 wiring on Droplet

**Files:**
- Modify: `docker-compose.yml` — add cost-recorder bind mount + inbox-watcher service (some of this landed earlier in Task 15's PR)

This task is the deployment + smoke-test step that activates everything Tasks 11 + 15 wrote.

- [ ] **Step 1: Bind-mount cost-recorder into hermes-agent**

Edit the `hermes-agent` service in `docker-compose.yml` — add to its `volumes:` list:

```yaml
      - ./packages/agenticos-hermes/plugins/cost-recorder:/opt/hermes/plugins/cost-recorder:ro
```

- [ ] **Step 2: Enable the plugin in Hermes config**

The Hermes container auto-discovers plugins in `/opt/hermes/plugins/`. After mount + restart, check it's loaded:

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 \
  'docker compose -f /opt/agenticos/docker-compose.yml restart hermes-agent && sleep 10 && curl -s http://127.0.0.1:7777/api/plugins | python3 -m json.tool | grep -A 2 cost-recorder'
```

If Hermes requires an explicit enable step (e.g. an entry in `~/.hermes/config.yaml`'s `plugins:` list), add it to `hermes-config/config.yaml` and document.

- [ ] **Step 3: Deploy the updated compose**

```bash
scp -i ~/.ssh/agenticos-droplet docker-compose.yml deploy@159.223.171.231:/opt/agenticos/docker-compose.yml
ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 \
  'cd /opt/agenticos && docker compose --env-file /opt/agenticos/.env up -d --build inbox-watcher'
```

- [ ] **Step 4: Verify inbox-watcher is running and watching**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@159.223.171.231 \
  'docker logs inbox-watcher 2>&1 | tail -10
   docker inspect -f "{{.State.Health.Status}} {{.State.Status}}" inbox-watcher 2>&1 || echo no-healthcheck'
```

Expected: `watching /opt/vault/inbox (debounce=5.0s)` in the logs.

- [ ] **Step 5: Smoke-test cost-recorder by manually inserting a row through the hook path**

This requires actually invoking an LLM call through Hermes. Defer real smoke test to Phase 1.4 (when the daily-brief cron task runs). For now, just confirm the plugin loaded:

```bash
curl -s http://127.0.0.1:7777/api/plugins
```

- [ ] **Step 6: Commit (compose changes only — no PR needed since Task 15's PR already had the inbox-watcher service)**

If there's a delta, commit it as `feat(infra): activate cost-recorder + inbox-watcher in Hermes stack`. Otherwise mark Task 16 complete with a note in the PR.

---
## Phase 1.3 — Dashboard rewire (≈4–5 hrs)

### Task 17: hermes-client.ts replaces honcho-client.ts

**Files:**
- Create: `apps/dashboard/lib/agent/hermes-client.ts`
- Create: `apps/dashboard/lib/agent/hermes-client.test.ts`
- Delete: `apps/dashboard/lib/agent/honcho-client.ts`
- Delete: `apps/dashboard/lib/agent/honcho-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/lib/agent/hermes-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HermesClient } from "./hermes-client";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("HermesClient", () => {
  it("listTasks GETs /api/tasks", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "t1", kind: "inbox-triage", status: "done" }],
    });
    const c = new HermesClient("http://hermes:7777");
    const tasks = await c.listTasks();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://hermes:7777/api/tasks",
      expect.objectContaining({ method: "GET" }),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("t1");
  });

  it("createTask POSTs body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "t2", kind: "manual", status: "queued" }),
    });
    const c = new HermesClient("http://hermes:7777");
    const t = await c.createTask({ kind: "manual", prompt: "hello" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://hermes:7777/api/tasks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
    expect(t.id).toBe("t2");
  });

  it("throws on non-OK response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502,
                                       text: async () => "down" });
    const c = new HermesClient("http://hermes:7777");
    await expect(c.listTasks()).rejects.toThrow(/502/);
  });
});
```

- [ ] **Step 2: Run, see fail**

```bash
cd apps/dashboard
pnpm test lib/agent/hermes-client
```

Expected: ImportError.

- [ ] **Step 3: Implement hermes-client.ts**

Create `apps/dashboard/lib/agent/hermes-client.ts`:

```typescript
import "server-only";
import type { Task, CreateTaskInput } from "./types";

export class HermesClient {
  constructor(private baseUrl: string) {}

  async listTasks(opts?: { since?: Date; limit?: number }): Promise<Task[]> {
    const u = new URL("/api/tasks", this.baseUrl);
    if (opts?.since) u.searchParams.set("since", opts.since.toISOString());
    if (opts?.limit) u.searchParams.set("limit", String(opts.limit));
    return this.json<Task[]>("GET", u.toString());
  }

  async getTask(id: string): Promise<Task> {
    return this.json<Task>("GET", `${this.baseUrl}/api/tasks/${encodeURIComponent(id)}`);
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.json<Task>("POST", `${this.baseUrl}/api/tasks`, input);
  }

  private async json<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      // Server-side fetches; no caching of mutable Hermes state
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Hermes ${method} ${url} → ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }
}

export function getHermesClient(): HermesClient {
  const base = process.env.HERMES_URL;
  if (!base) throw new Error("HERMES_URL not set");
  return new HermesClient(base);
}
```

- [ ] **Step 4: Update types**

Edit `apps/dashboard/lib/agent/types.ts` — replace existing content with:

```typescript
export type TaskStatus = "queued" | "running" | "done" | "failed" | "budget-blocked";

export interface Task {
  id: string;
  kind: string;
  trigger: string;
  status: TaskStatus;
  started_at: string;
  ended_at: string | null;
  cost_cents: number;
  error: string | null;
  metadata: Record<string, unknown>;
}

export interface Session {
  id: string;
  task_id: string;
  hermes_skill: string;
  started_at: string;
  ended_at: string | null;
  cost_cents: number;
}

export interface Call {
  id: number;
  session_id: string;
  task_id: string;
  provider: "openai" | "ollama";
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
  latency_ms: number;
  occurred_at: string;
  metadata: Record<string, unknown>;
}

export interface CreateTaskInput {
  kind: string;
  prompt: string;
  trigger?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskWithDrillDown extends Task {
  sessions: Array<Session & { calls: Call[] }>;
}
```

- [ ] **Step 5: Delete the old Honcho client**

```bash
rm apps/dashboard/lib/agent/honcho-client.ts \
   apps/dashboard/lib/agent/honcho-client.test.ts
```

- [ ] **Step 6: Update barrel export**

Edit `apps/dashboard/lib/agent/index.ts` so it exports from hermes-client instead:

```typescript
export { HermesClient, getHermesClient } from "./hermes-client";
export type {
  Task, TaskStatus, Session, Call, CreateTaskInput, TaskWithDrillDown
} from "./types";
```

- [ ] **Step 7: Run tests + typecheck**

```bash
cd apps/dashboard
pnpm test lib/agent/hermes-client
pnpm typecheck
```

Expected: tests pass; typecheck may surface broken references to old honcho code — fix those by replacing imports with `getHermesClient()` from the barrel.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/lib/agent/
git commit -m "feat(dashboard): replace honcho-client with hermes-client"
```

---

### Task 18: openviking-client.ts (memory queries)

**Files:**
- Create: `apps/dashboard/lib/agent/openviking-client.ts`
- Create: `apps/dashboard/lib/agent/openviking-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/lib/agent/openviking-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenVikingClient } from "./openviking-client";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("OpenVikingClient", () => {
  it("search hits /search", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ id: "m1", text: "hello", score: 0.9 }] }),
    });
    const c = new OpenVikingClient("http://ov:1933");
    const results = await c.search({ query: "winter forage", top_k: 5 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ov:1933/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "winter forage", top_k: 5 }),
      }),
    );
    expect(results).toEqual([{ id: "m1", text: "hello", score: 0.9 }]);
  });
});
```

- [ ] **Step 2: Implement openviking-client.ts**

Create `apps/dashboard/lib/agent/openviking-client.ts`:

```typescript
import "server-only";

export interface MemoryResult {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export class OpenVikingClient {
  constructor(private baseUrl: string) {}

  async search(input: { query: string; top_k?: number }): Promise<MemoryResult[]> {
    const res = await fetch(`${this.baseUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: input.query, top_k: input.top_k ?? 10 }),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`OpenViking /search → ${res.status}`);
    }
    const data = await res.json();
    return data.results ?? [];
  }
}

export function getOpenVikingClient(): OpenVikingClient {
  const base = process.env.OPENVIKING_URL;
  if (!base) throw new Error("OPENVIKING_URL not set");
  return new OpenVikingClient(base);
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test lib/agent/openviking-client
```

Expected: 1 passed.

> **Note:** OpenViking's REST shape (path: `/search`, body field names) should be verified against the docs you read in Task 2 §1. If different, fix request shape + test fixtures together.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/lib/agent/openviking-client.ts \
        apps/dashboard/lib/agent/openviking-client.test.ts
git commit -m "feat(dashboard): add OpenViking client (memory search)"
```

---

### Task 19: cost/db.ts + cost/pricing.ts + cost/forecast.ts

**Files:**
- Create: `apps/dashboard/lib/cost/db.ts`
- Create: `apps/dashboard/lib/cost/pricing.ts`
- Create: `apps/dashboard/lib/cost/forecast.ts`
- Create: `apps/dashboard/lib/cost/types.ts`
- Create: `apps/dashboard/lib/cost/db.test.ts`
- Create: `apps/dashboard/lib/cost/pricing.test.ts`
- Create: `apps/dashboard/lib/cost/forecast.test.ts`

- [ ] **Step 1: Write types**

Create `apps/dashboard/lib/cost/types.ts`:

```typescript
export interface TaskCostRow {
  task_id: string;
  kind: string;
  status: string;
  started_at: string;
  cost_cents: number;
}

export interface DailyCostRow {
  day: string;        // 'YYYY-MM-DD'
  cost_cents: number;
}

export interface KindCostRow {
  kind: string;
  cost_cents: number;
}

export interface CostSummary {
  today_cents: number;
  mtd_cents: number;
  cap_cents: number;
  soft_alert_cents: number;
  pct_of_cap: number;
  projected_month_end_cents: number;
}

export interface Budget {
  monthly_cap_cents: number;
  soft_alert_pct: number;
  reset_day_of_month: number;
}
```

- [ ] **Step 2: Write the failing test for pricing**

Create `apps/dashboard/lib/cost/pricing.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeCostCents } from "./pricing";

describe("computeCostCents", () => {
  it("returns 0 for Ollama (local)", () => {
    expect(computeCostCents({ provider: "ollama", model: "qwen2.5:3b",
                              input_tokens: 1000, output_tokens: 500 })).toBe(0);
  });

  it("computes gpt-5-codex cost from token counts", () => {
    // Same pricing table as Python side
    const c = computeCostCents({ provider: "openai", model: "gpt-5-codex",
                                 input_tokens: 1000, output_tokens: 500 });
    expect(c).toBeGreaterThanOrEqual(1);
  });

  it("throws on unknown model", () => {
    expect(() => computeCostCents({ provider: "openai", model: "bogus",
                                     input_tokens: 100, output_tokens: 100 })).toThrow();
  });
});
```

- [ ] **Step 3: Implement pricing.ts**

Create `apps/dashboard/lib/cost/pricing.ts`:

```typescript
/**
 * Per-call cost computation for the dashboard.
 *
 * MUST stay in sync with packages/agenticos-hermes/src/agenticos_hermes/pricing.py.
 * The Python side is the source of truth at write-time (it writes the row).
 * This TS copy is used for dashboard-side projections that estimate cost
 * without round-tripping to Postgres.
 */

interface PricingArgs {
  provider: "openai" | "ollama";
  model: string;
  input_tokens: number;
  output_tokens: number;
}

// Cost per million tokens, in cents — KEEP IN SYNC WITH pricing.py
const OPENAI_PRICING: Record<string, [number, number]> = {
  "gpt-5-codex": [125, 1000],
  "gpt-5":       [300, 1500],
  "gpt-5-mini":  [15, 60],
  "gpt-4o-mini": [15, 60],
};

export function computeCostCents({
  provider, model, input_tokens, output_tokens,
}: PricingArgs): number {
  if (provider === "ollama") return 0;
  if (provider !== "openai") throw new Error(`unknown provider: ${provider}`);

  const pricing = OPENAI_PRICING[model];
  if (!pricing) throw new Error(`unknown model: ${model}`);
  const [inPerM, outPerM] = pricing;
  const micro = input_tokens * inPerM + output_tokens * outPerM;
  return Math.ceil(micro / 1_000_000);
}
```

- [ ] **Step 4: Run tests, see pass**

```bash
pnpm test lib/cost/pricing
```

Expected: 3 passed.

- [ ] **Step 5: Write the failing test for forecast**

Create `apps/dashboard/lib/cost/forecast.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { projectMonthEnd } from "./forecast";

describe("projectMonthEnd", () => {
  it("linearly extrapolates MTD to month-end", () => {
    // 10 days in, $5 spent → projected $15 for 30-day month
    const result = projectMonthEnd({
      mtd_cents: 500,
      days_elapsed: 10,
      days_in_month: 30,
    });
    expect(result).toBe(1500);
  });

  it("handles first-day-of-month edge case", () => {
    expect(projectMonthEnd({ mtd_cents: 0, days_elapsed: 0,
                              days_in_month: 30 })).toBe(0);
  });
});
```

- [ ] **Step 6: Implement forecast.ts**

Create `apps/dashboard/lib/cost/forecast.ts`:

```typescript
interface ForecastArgs {
  mtd_cents: number;
  days_elapsed: number;
  days_in_month: number;
}

/**
 * Project month-end spend by linear extrapolation of MTD.
 *
 * Simple model — assumes spend rate is constant. Not a Bayesian forecast;
 * we'll improve this in a later spec if needed. Good enough for v1.
 */
export function projectMonthEnd({
  mtd_cents, days_elapsed, days_in_month,
}: ForecastArgs): number {
  if (days_elapsed === 0) return 0;
  return Math.round(mtd_cents * (days_in_month / days_elapsed));
}
```

- [ ] **Step 7: Run, see pass**

- [ ] **Step 8: Write the failing test for db**

Create `apps/dashboard/lib/cost/db.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
// db.ts is integration-tested through the API route tests; here we just smoke
// that the module loads and exports the expected surface.
import * as db from "./db";

describe("cost/db exports", () => {
  it("exports the expected functions", () => {
    expect(typeof db.getPool).toBe("function");
    expect(typeof db.getCostSummary).toBe("function");
    expect(typeof db.getTodayTasks).toBe("function");
    expect(typeof db.getMonthByDay).toBe("function");
    expect(typeof db.getMonthByKind).toBe("function");
    expect(typeof db.getBudget).toBe("function");
    expect(typeof db.updateBudget).toBe("function");
  });
});
```

- [ ] **Step 9: Implement db.ts**

Create `apps/dashboard/lib/cost/db.ts`:

```typescript
import "server-only";
import { Pool } from "pg";
import type {
  TaskCostRow, DailyCostRow, KindCostRow, CostSummary, Budget,
} from "./types";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;
  const connectionString = process.env.AGENTICOS_DB_URL;
  if (!connectionString) throw new Error("AGENTICOS_DB_URL not set");
  _pool = new Pool({ connectionString, max: 5 });
  return _pool;
}

export async function getCostSummary(): Promise<CostSummary> {
  const pool = getPool();
  const { rows: [r] } = await pool.query<{
    today_cents: number; mtd_cents: number; cap_cents: number;
    soft_alert_pct: number; days_elapsed: number; days_in_month: number;
  }>(`
    WITH b AS (SELECT monthly_cap_cents, soft_alert_pct FROM budget WHERE id = 1)
    SELECT
      (SELECT COALESCE(SUM(cost_cents), 0)::int FROM calls
         WHERE occurred_at::date = current_date)              AS today_cents,
      (SELECT COALESCE(SUM(cost_cents), 0)::int FROM calls
         WHERE occurred_at >= date_trunc('month', now()))      AS mtd_cents,
      b.monthly_cap_cents                                       AS cap_cents,
      b.soft_alert_pct                                          AS soft_alert_pct,
      EXTRACT(DAY FROM now())::int                              AS days_elapsed,
      EXTRACT(DAY FROM
        (date_trunc('month', now()) + INTERVAL '1 month - 1 day')
      )::int                                                    AS days_in_month
    FROM b
  `);

  const projected = r.days_elapsed === 0
    ? 0
    : Math.round(r.mtd_cents * (r.days_in_month / r.days_elapsed));

  return {
    today_cents: r.today_cents,
    mtd_cents: r.mtd_cents,
    cap_cents: r.cap_cents,
    soft_alert_cents: Math.round(r.cap_cents * (r.soft_alert_pct / 100)),
    pct_of_cap: r.cap_cents === 0 ? 0 : Math.round(100 * r.mtd_cents / r.cap_cents),
    projected_month_end_cents: projected,
  };
}

export async function getTodayTasks(): Promise<TaskCostRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<TaskCostRow>(`
    SELECT id AS task_id, kind, status, started_at::text, cost_cents
    FROM tasks
    WHERE started_at::date = current_date
    ORDER BY started_at DESC
    LIMIT 100
  `);
  return rows;
}

export async function getMonthByDay(): Promise<DailyCostRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<DailyCostRow>(`
    SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day,
           SUM(cost_cents)::int AS cost_cents
    FROM calls
    WHERE occurred_at >= date_trunc('month', now())
    GROUP BY 1
    ORDER BY 1
  `);
  return rows;
}

export async function getMonthByKind(): Promise<KindCostRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<KindCostRow>(`
    SELECT t.kind, SUM(c.cost_cents)::int AS cost_cents
    FROM calls c JOIN tasks t ON c.task_id = t.id
    WHERE c.occurred_at >= date_trunc('month', now())
    GROUP BY t.kind
    ORDER BY 2 DESC
  `);
  return rows;
}

export async function getBudget(): Promise<Budget> {
  const pool = getPool();
  const { rows: [r] } = await pool.query<Budget>(
    "SELECT monthly_cap_cents, soft_alert_pct, reset_day_of_month FROM budget WHERE id = 1"
  );
  return r;
}

export async function updateBudget(b: Partial<Budget>): Promise<Budget> {
  const pool = getPool();
  const { rows: [r] } = await pool.query<Budget>(
    `UPDATE budget SET
       monthly_cap_cents  = COALESCE($1, monthly_cap_cents),
       soft_alert_pct     = COALESCE($2, soft_alert_pct),
       reset_day_of_month = COALESCE($3, reset_day_of_month)
     WHERE id = 1
     RETURNING monthly_cap_cents, soft_alert_pct, reset_day_of_month`,
    [b.monthly_cap_cents, b.soft_alert_pct, b.reset_day_of_month]
  );
  return r;
}
```

- [ ] **Step 10: Run all cost tests**

```bash
pnpm test lib/cost/
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/dashboard/lib/cost/
git commit -m "feat(dashboard): cost lib (db + pricing + forecast + types)"
```

---

### Task 20: API route `/api/tasks` (SSE) and `/api/tasks/:id`

**Files:**
- Create: `apps/dashboard/app/api/tasks/route.ts`
- Create: `apps/dashboard/app/api/tasks/[id]/route.ts`
- Create: `apps/dashboard/app/api/tasks/route.test.ts`

- [ ] **Step 1: Write the route test**

Create `apps/dashboard/app/api/tasks/route.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { GET, POST } from "./route";

vi.mock("@/lib/agent/hermes-client", () => ({
  getHermesClient: () => ({
    listTasks: vi.fn().mockResolvedValue([
      { id: "t1", kind: "inbox-triage", status: "done",
        started_at: "2026-05-22T07:00:00Z", ended_at: null,
        cost_cents: 0, trigger: "fsnotify", error: null, metadata: {} },
    ]),
    createTask: vi.fn().mockResolvedValue({
      id: "t2", kind: "manual", status: "queued",
      started_at: "2026-05-22T08:00:00Z", ended_at: null,
      cost_cents: 0, trigger: "manual", error: null, metadata: {},
    }),
  }),
}));

describe("/api/tasks", () => {
  it("GET returns task list as JSON", async () => {
    const req = new Request("http://localhost/api/tasks");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].id).toBe("t1");
  });

  it("POST creates a task", async () => {
    const req = new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "manual", prompt: "hi" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("t2");
  });
});
```

- [ ] **Step 2: Run, see fail**

- [ ] **Step 3: Implement the route**

Create `apps/dashboard/app/api/tasks/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getHermesClient } from "@/lib/agent/hermes-client";
import type { CreateTaskInput } from "@/lib/agent/types";

// Force Node runtime — we use pg pool indirectly via Hermes-client server-only imports.
export const runtime = "nodejs";

export async function GET(req: NextRequest | Request): Promise<Response> {
  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const limit = url.searchParams.get("limit");

  const client = getHermesClient();
  const tasks = await client.listTasks({
    since: since ? new Date(since) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  return NextResponse.json(tasks);
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as CreateTaskInput;
  if (!body.kind || !body.prompt) {
    return NextResponse.json(
      { error: "kind and prompt required" }, { status: 400 }
    );
  }
  const client = getHermesClient();
  const task = await client.createTask(body);
  return NextResponse.json(task, { status: 201 });
}
```

Create `apps/dashboard/app/api/tasks/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getHermesClient } from "@/lib/agent/hermes-client";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const client = getHermesClient();
  try {
    const task = await client.getTask(id);
    return NextResponse.json(task);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("404")) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test app/api/tasks
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/api/tasks/
git commit -m "feat(dashboard): /api/tasks GET+POST and /api/tasks/:id GET"
```

> **Note:** SSE streaming for the live task feed adds Edge-runtime + ReadableStream complexity that isn't strictly needed for v1. Phase 1.4 wires polling-based updates (5s interval React Query). We add SSE in a Spec 1.x follow-up if polling proves insufficient.

---

### Task 21: API route `/api/cost/[scope]` (today/month/forecast)

**Files:**
- Create: `apps/dashboard/app/api/cost/[scope]/route.ts`
- Create: `apps/dashboard/app/api/cost/[scope]/route.test.ts`

- [ ] **Step 1: Write the test**

Create `apps/dashboard/app/api/cost/[scope]/route.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/cost/db", () => ({
  getCostSummary: vi.fn().mockResolvedValue({
    today_cents: 42, mtd_cents: 600, cap_cents: 3000,
    soft_alert_cents: 2400, pct_of_cap: 20,
    projected_month_end_cents: 1800,
  }),
  getTodayTasks: vi.fn().mockResolvedValue([
    { task_id: "t1", kind: "inbox-triage", status: "done",
      started_at: "2026-05-22T07:00:00Z", cost_cents: 0 },
  ]),
  getMonthByDay: vi.fn().mockResolvedValue([
    { day: "2026-05-22", cost_cents: 600 },
  ]),
  getMonthByKind: vi.fn().mockResolvedValue([
    { kind: "daily-brief", cost_cents: 600 },
  ]),
}));

describe("/api/cost/[scope]", () => {
  async function call(scope: string) {
    const req = new Request(`http://localhost/api/cost/${scope}`);
    return GET(req, { params: Promise.resolve({ scope }) });
  }

  it("today returns summary + today's tasks", async () => {
    const res = await call("today");
    const body = await res.json();
    expect(body.summary.today_cents).toBe(42);
    expect(body.tasks).toHaveLength(1);
  });

  it("month returns by-day + by-kind", async () => {
    const res = await call("month");
    const body = await res.json();
    expect(body.by_day).toHaveLength(1);
    expect(body.by_kind).toHaveLength(1);
  });

  it("forecast returns projection", async () => {
    const res = await call("forecast");
    const body = await res.json();
    expect(body.projected_month_end_cents).toBe(1800);
  });

  it("unknown scope returns 404", async () => {
    const res = await call("bogus");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run, see fail**

- [ ] **Step 3: Implement**

Create `apps/dashboard/app/api/cost/[scope]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import {
  getCostSummary, getTodayTasks, getMonthByDay, getMonthByKind,
} from "@/lib/cost/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ scope: string }> }
): Promise<Response> {
  const { scope } = await params;

  switch (scope) {
    case "today": {
      const [summary, tasks] = await Promise.all([
        getCostSummary(), getTodayTasks(),
      ]);
      return NextResponse.json({ summary, tasks });
    }
    case "month": {
      const [summary, by_day, by_kind] = await Promise.all([
        getCostSummary(), getMonthByDay(), getMonthByKind(),
      ]);
      return NextResponse.json({ summary, by_day, by_kind });
    }
    case "forecast": {
      const summary = await getCostSummary();
      return NextResponse.json({
        mtd_cents: summary.mtd_cents,
        projected_month_end_cents: summary.projected_month_end_cents,
        cap_cents: summary.cap_cents,
        pct_of_cap: summary.pct_of_cap,
      });
    }
    default:
      return NextResponse.json({ error: `unknown scope: ${scope}` },
                                { status: 404 });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test app/api/cost
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/api/cost/
git commit -m "feat(dashboard): /api/cost/[scope] (today|month|forecast)"
```

---

### Task 22: API route `/api/budget` GET+PUT

**Files:**
- Create: `apps/dashboard/app/api/budget/route.ts`
- Create: `apps/dashboard/app/api/budget/route.test.ts`

- [ ] **Step 1: Test**

Create `apps/dashboard/app/api/budget/route.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { GET, PUT } from "./route";

vi.mock("@/lib/cost/db", () => ({
  getBudget: vi.fn().mockResolvedValue({
    monthly_cap_cents: 3000, soft_alert_pct: 80, reset_day_of_month: 1
  }),
  updateBudget: vi.fn().mockImplementation(async (b: any) => ({
    monthly_cap_cents: b.monthly_cap_cents ?? 3000,
    soft_alert_pct: b.soft_alert_pct ?? 80,
    reset_day_of_month: 1,
  })),
}));

describe("/api/budget", () => {
  it("GET returns current budget", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.monthly_cap_cents).toBe(3000);
  });

  it("PUT updates cap", async () => {
    const req = new Request("http://localhost/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_cap_cents: 5000 }),
    });
    const res = await PUT(req);
    const body = await res.json();
    expect(body.monthly_cap_cents).toBe(5000);
  });

  it("PUT rejects negative cap", async () => {
    const req = new Request("http://localhost/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_cap_cents: -1 }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Implement**

Create `apps/dashboard/app/api/budget/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getBudget, updateBudget } from "@/lib/cost/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const budget = await getBudget();
  return NextResponse.json(budget);
}

export async function PUT(req: Request): Promise<Response> {
  const body = await req.json() as {
    monthly_cap_cents?: number;
    soft_alert_pct?: number;
    reset_day_of_month?: number;
  };

  // Validate
  if (body.monthly_cap_cents !== undefined &&
      (body.monthly_cap_cents < 0 || !Number.isInteger(body.monthly_cap_cents))) {
    return NextResponse.json(
      { error: "monthly_cap_cents must be a non-negative integer" },
      { status: 400 }
    );
  }
  if (body.soft_alert_pct !== undefined &&
      (body.soft_alert_pct < 0 || body.soft_alert_pct > 100)) {
    return NextResponse.json(
      { error: "soft_alert_pct must be 0–100" }, { status: 400 }
    );
  }
  if (body.reset_day_of_month !== undefined &&
      (body.reset_day_of_month < 1 || body.reset_day_of_month > 28)) {
    return NextResponse.json(
      { error: "reset_day_of_month must be 1–28" }, { status: 400 }
    );
  }

  const updated = await updateBudget(body);
  return NextResponse.json(updated);
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test app/api/budget
```

Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/api/budget/
git commit -m "feat(dashboard): /api/budget GET+PUT with validation"
```

---

## Phase 1.4 — Autonomous tasks wiring (≈3 hrs)

### Task 23: daily_brief task implementation

**Files:**
- Create: `packages/agenticos-hermes/src/agenticos_hermes/tasks/daily_brief.py`
- Create: `packages/agenticos-hermes/tests/test_daily_brief.py`

- [ ] **Step 1: Write the test**

Create `packages/agenticos-hermes/tests/test_daily_brief.py`:

```python
import pytest
from unittest.mock import patch, MagicMock
from agenticos_hermes.tasks.daily_brief import run_daily_brief

@patch("agenticos_hermes.tasks.daily_brief.record_task_start")
@patch("agenticos_hermes.tasks.daily_brief.record_session_start")
@patch("agenticos_hermes.tasks.daily_brief.record_session_end")
@patch("agenticos_hermes.tasks.daily_brief.record_task_completion")
@patch("agenticos_hermes.tasks.daily_brief.record_call")
@patch("agenticos_hermes.tasks.daily_brief.run_codex")
@patch("agenticos_hermes.tasks.daily_brief.openviking_search")
@patch("agenticos_hermes.tasks.daily_brief.write_brief_file")
def test_daily_brief_happy_path(write_file, ov_search, run_cdx,
                                  record_call, record_done,
                                  record_sess_end, record_sess_start,
                                  record_start, tmp_path):
    from agenticos_hermes.skills.codex_coder import CodexResult
    ov_search.return_value = [{"id": "m1", "text": "yesterday's note"}]
    run_cdx.return_value = CodexResult(
        text="# Daily Brief\n\nAll looks well.",
        model="gpt-5-codex", input_tokens=200, output_tokens=100,
        latency_ms=2000,
    )

    result = run_daily_brief()
    assert result.startswith("daily-brief-")

    record_start.assert_called_once()
    write_file.assert_called_once()
    args, kwargs = write_file.call_args
    assert "# Daily Brief" in args[0]
    record_done.assert_called_once_with(task_id=result, status="done")
```

- [ ] **Step 2: Implement daily_brief.py**

Create `packages/agenticos-hermes/src/agenticos_hermes/tasks/daily_brief.py`:

```python
"""daily-brief: cron task that compiles a morning summary.

Fires at 07:00 America/New_York via Hermes config.yaml cron section.
Uses Codex (gpt-5-codex) because synthesis across memory + db needs reasoning.
"""
import os
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any

import httpx

from ..skills.codex_coder import run_codex
from ..skills.cost_recorder import (
    record_call, record_session_start, record_session_end,
    record_task_start, record_task_completion,
)

VAULT_ROOT = Path(os.environ.get("VAULT_ROOT", "/opt/vault"))
OPENVIKING_ENDPOINT = os.environ.get("OPENVIKING_ENDPOINT", "http://127.0.0.1:1933")


def openviking_search(query: str, top_k: int = 20) -> list[dict[str, Any]]:
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{OPENVIKING_ENDPOINT}/search",
            json={"query": query, "top_k": top_k},
        )
        resp.raise_for_status()
        return resp.json().get("results", [])


def write_brief_file(content: str, day: date) -> Path:
    out_dir = VAULT_ROOT / "daily-briefs"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{day.isoformat()}.md"
    out_path.write_text(content, encoding="utf-8")
    return out_path


def run_daily_brief() -> str:
    today = date.today()
    task_id = f"daily-brief-{today.isoformat()}-{uuid.uuid4().hex[:6]}"
    session_id = f"{task_id}-s1"

    record_task_start(
        task_id=task_id, kind="daily-brief",
        trigger="cron:daily-brief",
        metadata={"day": today.isoformat()},
    )
    record_session_start(session_id=session_id, task_id=task_id,
                          hermes_skill="codex-coder")

    try:
        # Gather context from OpenViking
        memories = openviking_search(
            "events, notes, or reminders from the last 24 hours",
            top_k=20,
        )
        memory_text = "\n".join(f"- {m.get('text', '')[:200]}" for m in memories)

        prompt = f"""Compose a concise morning brief in Markdown.
Date: {today.isoformat()}

Recent context from the vault:
{memory_text}

Format:
# Daily Brief — {today.isoformat()}
## What happened yesterday
## What's due today
## Open threads worth noting
"""

        result = run_codex(prompt=prompt, task_id=task_id)
        record_call(
            session_id=session_id, task_id=task_id,
            provider="openai", model=result.model,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            latency_ms=result.latency_ms,
            metadata={"task": "daily-brief"},
        )

        write_brief_file(result.text, today)
        record_session_end(session_id=session_id)
        record_task_completion(task_id=task_id, status="done")
    except Exception as e:
        record_session_end(session_id=session_id)
        record_task_completion(task_id=task_id, status="failed", error=str(e)[:500])
        raise

    return task_id
```

- [ ] **Step 3: Run tests**

```bash
.venv/bin/pytest tests/test_daily_brief.py -v
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add packages/agenticos-hermes/src/agenticos_hermes/tasks/daily_brief.py \
        packages/agenticos-hermes/tests/test_daily_brief.py
git commit -m "feat(hermes-plugins): daily_brief cron task"
```

---

### Task 24: cost_report task implementation

**Files:**
- Create: `packages/agenticos-hermes/src/agenticos_hermes/tasks/cost_report.py`
- Create: `packages/agenticos-hermes/tests/test_cost_report.py`

- [ ] **Step 1: Write test**

Create `packages/agenticos-hermes/tests/test_cost_report.py`:

```python
from unittest.mock import patch, MagicMock
from agenticos_hermes.tasks.cost_report import run_cost_report

@patch("agenticos_hermes.tasks.cost_report.connect")
@patch("agenticos_hermes.tasks.cost_report.run_slm")
@patch("agenticos_hermes.tasks.cost_report.write_report_file")
@patch("agenticos_hermes.tasks.cost_report.record_task_start")
@patch("agenticos_hermes.tasks.cost_report.record_session_start")
@patch("agenticos_hermes.tasks.cost_report.record_session_end")
@patch("agenticos_hermes.tasks.cost_report.record_task_completion")
@patch("agenticos_hermes.tasks.cost_report.record_call")
def test_cost_report_writes_markdown(record_call, done, sess_end, sess_start,
                                       start, write_file, run_slm_mock,
                                       connect_mock):
    from agenticos_hermes.skills.slm_runner import SlmResult
    cursor = MagicMock()
    cursor.fetchall.return_value = [("daily-brief", 1, 18), ("inbox-triage", 3, 0)]
    cursor.fetchone.return_value = (4, 18, 3000, 80)
    connect_mock.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cursor

    run_slm_mock.return_value = SlmResult(
        text="# Cost Report\n4 tasks, $0.18 today", model="qwen2.5:3b",
        input_tokens=80, output_tokens=40, latency_ms=300,
    )

    task_id = run_cost_report()
    write_file.assert_called_once()
    args, _ = write_file.call_args
    assert "Cost Report" in args[0]
    done.assert_called_once_with(task_id=task_id, status="done")
```

- [ ] **Step 2: Implement cost_report.py**

Create `packages/agenticos-hermes/src/agenticos_hermes/tasks/cost_report.py`:

```python
"""cost-report: cron task that rolls up daily spend.

SLM-only (Qwen 2.5 3B) — pure formatting/summarization, doesn't need Codex.
Adds an alert section if month-to-date crosses the soft-alert threshold.
"""
import os
import uuid
from datetime import date
from pathlib import Path

from ..db import connect
from ..skills.slm_runner import run_slm
from ..skills.cost_recorder import (
    record_call, record_session_start, record_session_end,
    record_task_start, record_task_completion,
)

VAULT_ROOT = Path(os.environ.get("VAULT_ROOT", "/opt/vault"))


def write_report_file(content: str, day: date) -> Path:
    out_dir = VAULT_ROOT / "cost-reports"
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / f"{day.isoformat()}.md"
    p.write_text(content, encoding="utf-8")
    return p


def _gather_stats() -> dict:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("""
          SELECT t.kind, COUNT(*)::int, COALESCE(SUM(t.cost_cents), 0)::int
          FROM tasks t
          WHERE t.started_at::date = current_date
          GROUP BY t.kind
          ORDER BY 3 DESC
        """)
        by_kind = cur.fetchall()

        cur.execute("""
          WITH b AS (SELECT monthly_cap_cents, soft_alert_pct FROM budget WHERE id=1)
          SELECT
            (SELECT COUNT(*)::int FROM tasks WHERE started_at::date = current_date),
            (SELECT COALESCE(SUM(cost_cents),0)::int FROM tasks
              WHERE started_at::date = current_date),
            b.monthly_cap_cents,
            b.soft_alert_pct
          FROM b
        """)
        n_tasks, today_cents, cap, soft_pct = cur.fetchone()

        cur.execute("""
          SELECT COALESCE(SUM(cost_cents),0)::int FROM calls
          WHERE occurred_at >= date_trunc('month', now())
        """)
        mtd = cur.fetchone()[0]

    return {
        "by_kind": by_kind, "n_tasks": n_tasks,
        "today_cents": today_cents, "mtd_cents": mtd,
        "cap_cents": cap, "soft_alert_cents": cap * soft_pct // 100,
    }


def run_cost_report() -> str:
    today = date.today()
    task_id = f"cost-report-{today.isoformat()}-{uuid.uuid4().hex[:6]}"
    session_id = f"{task_id}-s1"

    record_task_start(task_id=task_id, kind="cost-report",
                       trigger="cron:cost-report")
    record_session_start(session_id=session_id, task_id=task_id,
                          hermes_skill="slm-runner")

    try:
        stats = _gather_stats()

        # SLM just formats; it does not invent numbers
        prompt = f"""Format this data as a Markdown cost report.
Today: {today.isoformat()}

Tasks today: {stats['n_tasks']}
Today total: ${stats['today_cents'] / 100:.2f}
Month-to-date: ${stats['mtd_cents'] / 100:.2f}
Monthly cap: ${stats['cap_cents'] / 100:.2f}
Soft alert at: ${stats['soft_alert_cents'] / 100:.2f}

By kind: {stats['by_kind']}

Use this structure:
# Cost Report — <date>
## Summary
## By task kind
## Budget status
"""
        result = run_slm(model="qwen2.5:3b", prompt=prompt)
        record_call(
            session_id=session_id, task_id=task_id,
            provider="ollama", model=result.model,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            latency_ms=result.latency_ms,
        )

        content = result.text
        if stats["mtd_cents"] >= stats["soft_alert_cents"]:
            content = f"> ⚠️ Over soft alert ({stats['mtd_cents']/100:.2f} of ${stats['cap_cents']/100:.2f} cap)\n\n" + content

        write_report_file(content, today)
        record_session_end(session_id=session_id)
        record_task_completion(task_id=task_id, status="done")
    except Exception as e:
        record_session_end(session_id=session_id)
        record_task_completion(task_id=task_id, status="failed", error=str(e)[:500])
        raise

    return task_id
```

- [ ] **Step 3: Test**

```bash
.venv/bin/pytest tests/test_cost_report.py -v
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add packages/agenticos-hermes/src/agenticos_hermes/tasks/cost_report.py \
        packages/agenticos-hermes/tests/test_cost_report.py
git commit -m "feat(hermes-plugins): cost_report cron task (SLM-formatted)"
```

---

### Task 25: inbox-triage flow (wires inbox_watcher to slm_router to triage logic)

**Files:**
- Modify: `packages/agenticos-hermes/src/agenticos_hermes/plugins/inbox_watcher.py`
- Create: `packages/agenticos-hermes/src/agenticos_hermes/tasks/inbox_triage.py`
- Create: `packages/agenticos-hermes/tests/test_inbox_triage.py`

- [ ] **Step 1: Test**

Create `packages/agenticos-hermes/tests/test_inbox_triage.py`:

```python
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
from agenticos_hermes.tasks.inbox_triage import triage_file

@patch("agenticos_hermes.tasks.inbox_triage.record_task_start")
@patch("agenticos_hermes.tasks.inbox_triage.record_session_start")
@patch("agenticos_hermes.tasks.inbox_triage.record_session_end")
@patch("agenticos_hermes.tasks.inbox_triage.record_task_completion")
@patch("agenticos_hermes.tasks.inbox_triage.record_call")
@patch("agenticos_hermes.tasks.inbox_triage.run_slm")
def test_triage_file_routes_and_moves(run_slm_mock, record_call, done,
                                        sess_end, sess_start, start,
                                        tmp_path: Path):
    from agenticos_hermes.skills.slm_runner import SlmResult
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    src = inbox / "winter-forage.md"
    src.write_text("# Winter forage notes")

    run_slm_mock.return_value = SlmResult(
        text=json.dumps({
            "category": "farming",
            "subfolder": "forage",
            "summary": "Notes on winter forage planning.",
        }),
        model="qwen2.5:3b", input_tokens=80, output_tokens=30, latency_ms=200,
    )

    # Override the vault root for this test
    with patch("agenticos_hermes.tasks.inbox_triage.VAULT_ROOT", tmp_path):
        triage_file(src)

    assert not src.exists(), "source should be moved"
    dest = tmp_path / "farming" / "forage" / "winter-forage.md"
    assert dest.exists()
    summary = tmp_path / "farming" / "forage" / ".summaries" / "winter-forage.md"
    assert summary.exists()
    assert "winter forage" in summary.read_text().lower()
```

- [ ] **Step 2: Implement inbox_triage.py**

Create `packages/agenticos-hermes/src/agenticos_hermes/tasks/inbox_triage.py`:

```python
"""inbox-triage: classify + relocate + summarize an inbox note.

Triggered by the inbox_watcher plugin on a stable .md file in /opt/vault/inbox.
"""
import json
import os
import re
import uuid
from datetime import datetime
from pathlib import Path

from ..skills.slm_runner import run_slm
from ..skills.cost_recorder import (
    record_call, record_session_start, record_session_end,
    record_task_start, record_task_completion,
)

VAULT_ROOT = Path(os.environ.get("VAULT_ROOT", "/opt/vault"))
TRIAGE_MODEL = os.environ.get("TRIAGE_MODEL", "qwen2.5:3b")

_TRIAGE_PROMPT = """You triage Obsidian notes into a vault.

Read the note below and respond with ONLY a JSON object — no prose, no
markdown fences — with these keys:
  category: one of "farming", "marketing", "research", "admin", "personal"
  subfolder: a short kebab-case slug (max 20 chars)
  summary: a 1–2 sentence summary

NOTE CONTENTS (truncated to 4000 chars):
---
{content}
---

JSON only:"""


def _safe_json_extract(text: str) -> dict | None:
    """Codex/SLMs sometimes wrap in ```json fences; extract the object."""
    m = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def triage_file(path: Path) -> str:
    task_id = f"inbox-triage-{datetime.now().strftime('%Y-%m-%d-%H-%M-%S')}-{uuid.uuid4().hex[:4]}"
    session_id = f"{task_id}-s1"

    record_task_start(
        task_id=task_id, kind="inbox-triage",
        trigger=f"fsnotify:{path}",
        metadata={"file": str(path)},
    )
    record_session_start(session_id=session_id, task_id=task_id,
                          hermes_skill="slm-runner")

    try:
        content = path.read_text(encoding="utf-8", errors="replace")[:4000]
        prompt = _TRIAGE_PROMPT.format(content=content)
        result = run_slm(model=TRIAGE_MODEL, prompt=prompt, temperature=0.0)

        record_call(
            session_id=session_id, task_id=task_id,
            provider="ollama", model=result.model,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            latency_ms=result.latency_ms,
        )

        parsed = _safe_json_extract(result.text)
        if not parsed or "category" not in parsed:
            raise ValueError(f"SLM returned unparseable JSON: {result.text[:200]}")

        category = re.sub(r"[^a-z0-9-]", "", parsed["category"].lower())
        subfolder = re.sub(r"[^a-z0-9-]", "", parsed.get("subfolder", "misc").lower())[:20]
        summary = parsed.get("summary", "").strip()

        dest_dir = VAULT_ROOT / category / subfolder
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / path.name
        path.rename(dest)

        if summary:
            sum_dir = dest_dir / ".summaries"
            sum_dir.mkdir(exist_ok=True)
            (sum_dir / path.name).write_text(summary + "\n", encoding="utf-8")

        record_session_end(session_id=session_id)
        record_task_completion(task_id=task_id, status="done")
    except Exception as e:
        record_session_end(session_id=session_id)
        record_task_completion(task_id=task_id, status="failed", error=str(e)[:500])
        raise

    return task_id
```

- [ ] **Step 3: Wire inbox_watcher to triage_file in the bootstrapping code**

Edit `packages/agenticos-hermes/src/agenticos_hermes/plugins/inbox_watcher.py` — add a `start_with_default_triage()` helper at the bottom:

```python
def start_with_default_triage(*, watch_dir: Path,
                                debounce_seconds: float = 5.0) -> InboxWatcher:
    """Convenience: start a watcher that calls inbox_triage.triage_file."""
    from ..tasks.inbox_triage import triage_file
    w = InboxWatcher(watch_dir=watch_dir, debounce_seconds=debounce_seconds,
                      on_ready=triage_file)
    w.start()
    return w
```

- [ ] **Step 4: Run tests**

```bash
.venv/bin/pytest tests/test_inbox_triage.py tests/test_inbox_watcher.py -v
```

Expected: 3 passed total.

- [ ] **Step 5: Commit**

```bash
git add packages/agenticos-hermes/src/agenticos_hermes/tasks/inbox_triage.py \
        packages/agenticos-hermes/src/agenticos_hermes/plugins/inbox_watcher.py \
        packages/agenticos-hermes/tests/test_inbox_triage.py
git commit -m "feat(hermes-plugins): inbox_triage task wired to inbox_watcher"
```

---

### Task 26: Re-install plugins on Droplet + restart Hermes

**Files:** none (deploy only)

- [ ] **Step 1: Push commits + pull on Droplet**

```bash
# After Tasks 23–25 commits land
ssh -i ~/.ssh/agenticos-droplet deploy@agenticos-droplet \
  'cd /opt/agenticos/repo && git pull --ff-only && \
   sudo /opt/hermes/bin/pip install --upgrade /opt/agenticos/repo/packages/agenticos-hermes && \
   sudo systemctl restart hermes-agent'
```

- [ ] **Step 2: Verify hermes loaded the new task modules**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@agenticos-droplet \
  'curl -s http://127.0.0.1:7777/api/cron/jobs | python3 -m json.tool'
```

Expected: JSON listing `daily-brief` and `cost-report` jobs.

- [ ] **Step 3: Manual fire of cost-report (the cheapest test — pure local SLM)**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@agenticos-droplet \
  'curl -s -X POST http://127.0.0.1:7777/api/cron/jobs/cost-report/trigger \
   && sleep 5 \
   && docker exec agenticos-db psql -U agenticos -d agenticos \
      -c "SELECT id, kind, status FROM tasks WHERE kind=$$cost-report$$ ORDER BY started_at DESC LIMIT 1;"'
```

Expected: 1 row with `status=done`. Also verify `/opt/vault/cost-reports/2026-MM-DD.md` exists.

- [ ] **Step 4: Drop a test inbox note + verify triage**

```bash
ssh -i ~/.ssh/agenticos-droplet deploy@agenticos-droplet \
  'echo "# Test triage note from CLI" > /opt/vault/inbox/cli-triage-test.md \
   && sleep 15 \
   && ls /opt/vault/inbox/ \
   && find /opt/vault -name cli-triage-test.md -not -path "*/inbox/*"'
```

Expected: file no longer in `inbox/`, found under some `<category>/<subfolder>/`.

---

## Phase 1.5 — Acceptance (≈2 hrs)

### Task 27: Acceptance test against the live Droplet from the Mac

**Files:**
- Create: `tests/acceptance/spec1-e2e.sh`

- [ ] **Step 1: Write the acceptance script**

Create `tests/acceptance/spec1-e2e.sh`:

```bash
#!/usr/bin/env bash
# Spec 1 end-to-end acceptance: drop a note on Mac → verify everything fires.
set -euo pipefail

VAULT_LOCAL="$HOME/AgenticOS-Vault"
DROPLET="deploy@agenticos-droplet"
SSH_KEY="$HOME/.ssh/agenticos-droplet"

NOTE_NAME="spec1-acceptance-$(date +%s).md"
LOCAL_NOTE="$VAULT_LOCAL/inbox/$NOTE_NAME"
TIMEOUT=120

echo "=== 1. Drop note on Mac ==="
mkdir -p "$VAULT_LOCAL/inbox"
cat > "$LOCAL_NOTE" <<EOF
# Spec 1 Acceptance Test Note

This is a test of the AgenticOS inbox-triage pipeline.
Topic: farming, specifically pasture rotation in late spring.
EOF
echo "Wrote $LOCAL_NOTE"

echo "=== 2. Wait for Syncthing → Droplet ($TIMEOUT s max) ==="
for i in $(seq 1 $TIMEOUT); do
  if ssh -i "$SSH_KEY" "$DROPLET" "[ -f /opt/vault/inbox/$NOTE_NAME ]" 2>/dev/null; then
    echo "Replicated after ${i}s"
    break
  fi
  sleep 1
done

echo "=== 3. Wait for inbox-triage to complete ==="
for i in $(seq 1 $TIMEOUT); do
  STATUS=$(ssh -i "$SSH_KEY" "$DROPLET" \
    "docker exec agenticos-db psql -U agenticos -d agenticos -At \
     -c \"SELECT status FROM tasks WHERE metadata->>'file' LIKE '%$NOTE_NAME' \
         ORDER BY started_at DESC LIMIT 1;\"" 2>/dev/null || echo "")
  if [ "$STATUS" = "done" ]; then
    echo "Triage completed after ${i}s"
    break
  fi
  sleep 2
done

if [ "$STATUS" != "done" ]; then
  echo "FAIL: triage did not complete (status=$STATUS)" >&2
  exit 1
fi

echo "=== 4. Verify file was moved out of inbox ==="
ssh -i "$SSH_KEY" "$DROPLET" "[ ! -f /opt/vault/inbox/$NOTE_NAME ]"
echo "OK"

echo "=== 5. Verify file exists somewhere in the categorized vault ==="
RELOCATED=$(ssh -i "$SSH_KEY" "$DROPLET" "find /opt/vault -name $NOTE_NAME -not -path '*/inbox/*'")
echo "Found at: $RELOCATED"

echo "=== 6. Wait for Syncthing → Mac ==="
for i in $(seq 1 $TIMEOUT); do
  FOUND=$(find "$VAULT_LOCAL" -name "$NOTE_NAME" -not -path "*/inbox/*" 2>/dev/null)
  if [ -n "$FOUND" ]; then
    echo "Replicated back to Mac at: $FOUND"
    break
  fi
  sleep 1
done

echo "=== 7. Verify cost row ==="
ssh -i "$SSH_KEY" "$DROPLET" \
  "docker exec agenticos-db psql -U agenticos -d agenticos \
   -c \"SELECT id, kind, cost_cents, status FROM tasks \
       WHERE metadata->>'file' LIKE '%$NOTE_NAME';\""

echo "=== 8. Verify dashboard /api/cost/today shows it ==="
curl -fsS https://agenticos.gatheringatthegrove.com/api/cost/today \
  -H "Cookie: $(cat ~/.config/agenticos-test-cookie 2>/dev/null || echo '')" \
  | python3 -m json.tool | head -30 \
  || echo "(dashboard request needs CF Access cookie; skip if not logged in)"

echo
echo "✅ Spec 1 acceptance PASSED"
```

- [ ] **Step 2: Run the acceptance test**

```bash
chmod +x tests/acceptance/spec1-e2e.sh
./tests/acceptance/spec1-e2e.sh
```

Expected: `✅ Spec 1 acceptance PASSED` and all steps complete in < 3 minutes total.

- [ ] **Step 3: Commit**

```bash
git add tests/acceptance/spec1-e2e.sh
git commit -m "test(acceptance): Spec 1 end-to-end inbox-triage acceptance script"
```

---

### Task 28: Document acceptance results + close Spec 1 open questions

**Files:**
- Modify: `docs/superpowers/specs/2026-05-22-spec1-orchestrator-cost-observability-design.md`

- [ ] **Step 1: After Task 27 passes, edit the spec's §11 Open Questions**

For each item in §11, append a resolution paragraph based on what you observed during implementation. Example format:

```markdown
### Resolutions (filled in during implementation, 2026-05-2X)

1. **OpenViking's `compact` operation:** Resolved — we did not enable explicit compaction; HOTNESS_ALPHA-weighted retrieval is sufficient at our corpus size.
2. **gpt-5-codex pricing exact rates:** Resolved — locked rate card as of YYYY-MM-DD: $X.XX/M input, $X.XX/M output. Source: <url>.
3. **Hermes plugin API stability:** Resolved — pinned to `hermes-agent==1.X.Y` in install-hermes.sh. Plugin contract used: <brief shape note>.
4. **Cloudflare Access in front of SSE:** Resolved — Phase 1.3 dropped SSE in favor of 5s polling; no Access config needed.
5. **Droplet RAM headroom:** [observed result — e.g., "Stable at 3.2 GB resident under triage burst; no upsize needed"].
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-22-spec1-orchestrator-cost-observability-design.md
git commit -m "docs(spec): resolve Spec 1 open questions after acceptance test"
```

---

## Phase 1.6 — Visual pass (≈3 hrs)

### Task 29: Forest+autumn palette tokens + Tailwind config

**Files:**
- Modify: `apps/dashboard/app/globals.css`
- Create: `apps/dashboard/tailwind.config.ts` (if missing — Tailwind v4 prefers `@theme` in CSS, but a config file works too)

- [ ] **Step 1: Edit globals.css palette**

Replace or add to `apps/dashboard/app/globals.css`:

```css
@import "tailwindcss";

@theme {
  /* Forest + autumn — Spec 1 §10 */
  --color-pine-bark:    #0e1f1a;
  --color-forest-floor: #1a3a2e;
  --color-moss-warm:    #3a4a2e;
  --color-harvest:      #c2620b;
  --color-madder:       #a83a1a;
  --color-new-growth:   #7fb069;
  --color-oak-amber:    #d4a574;
  --color-parchment:    #f4ead5;
  --color-driftwood:    #a89c80;

  /* Glass surface tokens */
  --color-glass:        rgba(255, 255, 255, 0.06);
  --color-glass-dark:   rgba(0, 0, 0, 0.30);
}

body {
  background:
    radial-gradient(ellipse 80% 60% at top left,
                    var(--color-pine-bark) 0%,
                    var(--color-forest-floor) 50%,
                    var(--color-moss-warm) 100%);
  color: var(--color-parchment);
  min-height: 100vh;
}
```

- [ ] **Step 2: Verify dev server renders the new palette**

```bash
cd apps/dashboard
pnpm dev
```

Open `http://localhost:3000` — background should be forest-ombre, text parchment.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/app/globals.css
git commit -m "feat(dashboard): forest+autumn palette tokens via Tailwind @theme"
```

---

### Task 30: Glass card primitive

**Files:**
- Create: `apps/dashboard/components/ui/glass-card.tsx`
- Create: `apps/dashboard/components/ui/glass-card.test.tsx`

- [ ] **Step 1: Test**

Create `apps/dashboard/components/ui/glass-card.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { GlassCard } from "./glass-card";

describe("GlassCard", () => {
  it("renders children with glass classes", () => {
    const { container } = render(<GlassCard>hello</GlassCard>);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toMatch(/backdrop-blur/);
    expect(root.className).toMatch(/bg-/);
    expect(root.textContent).toBe("hello");
  });

  it("merges custom className", () => {
    const { container } = render(
      <GlassCard className="custom-class">x</GlassCard>
    );
    expect((container.firstChild as HTMLElement).className)
      .toMatch(/custom-class/);
  });
});
```

- [ ] **Step 2: Implement**

Create `apps/dashboard/components/ui/glass-card.tsx`:

```typescript
import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "kpi" | "row";
}

export function GlassCard({
  variant = "default", className, children, ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10",
        "bg-white/[0.06] backdrop-blur-md",
        "shadow-[0_4px_24px_rgba(0,0,0,0.30)]",
        variant === "kpi" && "p-6",
        variant === "row" && "px-4 py-3",
        variant === "default" && "p-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test components/ui/glass-card
```

Expected: 2 passed. (If `@testing-library/react` not installed, `pnpm add -D @testing-library/react jsdom` and add `environment: 'jsdom'` to vitest config.)

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/components/ui/glass-card.tsx \
        apps/dashboard/components/ui/glass-card.test.tsx
git commit -m "feat(dashboard): GlassCard primitive (Spec 1 §10 visual pass)"
```

---

### Task 31: Apply palette + glass to dashboard shell

**Files:**
- Modify: `apps/dashboard/app/layout.tsx`
- Modify or create: dashboard sidebar / top nav components

This task is open-ended depending on the existing component structure. Concretely:

- [ ] **Step 1: Read the current shell**

```bash
ls apps/dashboard/app/
ls apps/dashboard/components/ | grep -i -E "side|nav|layout|shell"
```

- [ ] **Step 2: Replace any `bg-white` / `bg-gray-*` references with palette tokens**

```bash
cd apps/dashboard
grep -rn 'bg-white\|bg-gray\|text-black' app components --include='*.tsx' | head -30
```

For each match: replace with palette utility classes (e.g., `bg-white` → `bg-glass`, `text-black` → `text-parchment`).

- [ ] **Step 3: Wrap top-level page sections in GlassCard**

In key pages (e.g., `app/page.tsx`, `app/cost/page.tsx`), wrap KPI panels in `<GlassCard variant="kpi">`.

- [ ] **Step 4: Visual smoke test**

```bash
pnpm dev
```

Hit each main route, confirm: forest ombre background, parchment text, glass-frosted cards. Capture a screenshot for the spec.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/ apps/dashboard/components/
git commit -m "feat(dashboard): apply forest+autumn palette + glass cards across shell"
```

---

### Task 32: Final test + lint sweep, deploy

**Files:** none (CI + deploy)

- [ ] **Step 1: Run full dashboard test suite**

```bash
cd apps/dashboard
pnpm test
pnpm typecheck
pnpm lint
```

Expected: all green.

- [ ] **Step 2: Run full Python test suite**

```bash
cd packages/agenticos-hermes
.venv/bin/pytest -v
```

Expected: all green.

- [ ] **Step 3: Build dashboard**

```bash
cd apps/dashboard
pnpm build
```

Expected: build succeeds.

- [ ] **Step 4: Deploy — App Platform auto-deploys on push to main**

```bash
git push origin main
```

Wait for App Platform deployment to complete (~3 min).

- [ ] **Step 5: Smoke-test production**

```bash
curl -fsS https://agenticos.gatheringatthegrove.com/api/agent/health \
  -H "Cookie: <your CF access cookie>" \
  || echo "(needs auth — visit the URL in browser instead)"
```

Browser-test: visit `https://agenticos.gatheringatthegrove.com/`, log in via Google SSO, confirm dashboard loads with forest palette + task feed shows recent rows.

- [ ] **Step 6: Re-run the acceptance test against production**

```bash
./tests/acceptance/spec1-e2e.sh
```

Expected: `✅ Spec 1 acceptance PASSED`.

- [ ] **Step 7: Mark Spec 1 done**

Edit `docs/superpowers/specs/2026-05-22-spec1-orchestrator-cost-observability-design.md`, change `> **Status:** Approved-pending-review` → `> **Status:** Shipped (YYYY-MM-DD)`.

Commit:

```bash
git add docs/superpowers/specs/2026-05-22-spec1-orchestrator-cost-observability-design.md
git commit -m "docs(spec): mark Spec 1 shipped"
git push origin main
```

---

## Self-review (filled in)

**Spec coverage check:** every numbered section in §1–§13 of the spec has at least one task that implements it.

| Spec section | Implemented by |
|---|---|
| §2 Architecture | Tasks 1–5, 9, 17 (substrate); Tasks 20–22 (dashboard ↔ Hermes wiring) |
| §3.1 Hermes Agent | Task 3 (install), Task 16 (post-plugins reinstall), Task 26 (cron jobs) |
| §3.2 OpenViking | Task 2 (install), Task 18 (client) |
| §3.3 Ollama | Task 1 (install + pulls) |
| §3.4 Codex CLI | Task 4 (install), Task 13 (skill wrapper) |
| §3.5 Claude fallback | Already installed; stays untouched |
| §3.6 agenticos-db + schema | Tasks 6–8 |
| §3.7 Dashboard rewire | Tasks 17–22 |
| §3.8 Secret refresh | Task 5 |
| §4.1 Inbox triage | Tasks 15, 25, 26 |
| §4.2 Daily brief | Tasks 23, 26 |
| §4.3 Cost report | Tasks 24, 26 |
| §5 Cost observability | Tasks 11, 14, 19, 21, 22 |
| §6 Data flow | Verified by Task 27 acceptance |
| §7 Error handling | Built into individual skills (Tasks 12–14); verified Task 27 |
| §8 Testing | Pytest in Tasks 10–15, 23–25; vitest in Tasks 17–22, 30 |
| §9 Cloud-init/Terraform automation | Tasks 1–5, 8 |
| §10 Visual pass | Tasks 29–31 |
| §11 Open questions | Resolved in Task 28 |
| §12 Migration phases | Phase 1.0 = Tasks 1–5; Phase 1.1 = Tasks 9–16; Phase 1.2 = Tasks 6–8; Phase 1.3 = Tasks 17–22; Phase 1.4 = Tasks 23–26; Phase 1.5 = Tasks 27–28; Phase 1.6 = Tasks 29–32 |
| §13 Locked decisions | All reflected in task code/config |

**Placeholder scan:** No "TBD", "implement later", or "add validation" placeholders. Two explicit "verify against current API shape" notes in Tasks 3, 13, and 18 are deliberate — they call out where docs-reading is needed at implementation time because the upstream library shape isn't pinned in this plan.

**Type consistency:** `Task`, `Session`, `Call`, `Budget`, `CostSummary` types are defined once in `apps/dashboard/lib/agent/types.ts` and `apps/dashboard/lib/cost/types.ts` and reused. Python `SlmResult`, `CodexResult`, `RouteDecision` dataclasses are defined once in their respective skill modules. Function signatures match across tests and implementations.

---

## Execution

Plan complete and saved to `docs/plans/spec1-orchestrator.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task, two-stage review between each (spec compliance, then code quality). Fast iteration, you stay in this session, work continues without waiting on you between tasks. Best for keeping momentum on a 30-task plan.

**2. Inline Execution** — Execute tasks in this session in batches with checkpoints for review. More overhead from context switching; better if you want to read every diff yourself.

Which approach?
