# Spec 1 — Verified API Shapes (post-spike findings)

> Captured 2026-05-22 during Phase 1.0a verification spike.
> Updates `2026-05-22-spec1-orchestrator-cost-observability-design.md` §3 and the corresponding tasks in `docs/plans/spec1-orchestrator.md`.

## TL;DR — what changed from the plan's assumptions

| Subsystem | Plan assumed | Reality | Action |
|---|---|---|---|
| **Hermes Agent install** | `pip install hermes-agent` + venv + systemd | **Docker image `nousresearch/hermes-agent:main`**, `HERMES_HOME=/opt/data` volume | Pivot Phase 1.0 Task 3 to docker-compose |
| **Hermes version** | `>=1.0,<2.0` | **`0.14.0`** (no 1.x exists yet) | Update version pin |
| **OpenViking install** | `pip install openviking` + venv + systemd | **Docker image `ghcr.io/volcengine/openviking:v0.3.19`** with `OPENVIKING_CONFIG_FILE=/app/.openviking/ov.conf` | Pivot Phase 1.0 Task 2 to docker-compose |
| **OpenViking config** | YAML `~/.openviking/config.yaml` | **TOML/INI `ov.conf` at `/app/.openviking/ov.conf`** | Rewrite config template |
| **OpenViking CLI** | `openviking-server` only | Two binaries: **`ov`** (data CLI: `find`/`read`/`search`/`add-memory`) and **`openviking-server`** (HTTP) | Use `ov` for memory ops, server for REST |
| **Codex CLI invocation** | `codex --print --json` | **`codex exec --json`** (subcommand, not flag) | Update `codex_coder.py` |
| **Codex auth** | `OPENAI_API_KEY` env-var inheritance | **`codex login --with-api-key` (one-time, persisted)** | One-time setup step, not env-only |
| **Codex flags needed for autonomous use** | None specified | **`--skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --sandbox read-only`** | Add to subprocess invocation |
| **Codex JSONL events** | Guessed `metadata` / `message` / `usage` | **Actual: `thread.started`, `turn.started`, `error`, `turn.failed`** (success-path `message`/`usage` shape still TBD — billing required to verify) | Rewrite parser |
| **Telemetry DB connection from Hermes** | Native systemd `EnvironmentFile=` | **Pass via docker-compose `environment:`** | Trivial config change |

## Verified details

### 1. GitHub push automation

- `gh auth status`: ✅ authenticated with `repo` + `workflow` scopes
- Repo settings: ✅ `allow_auto_merge=true`, `delete_branch_on_merge=true` (set via `gh api -X PATCH`)
- Squash merge: ✅ already enabled
- **Workflow:** push to `agenticos/spec1-task-NN` branch → `gh pr create --base main` → `gh pr merge --squash --auto` → auto-merges when CI passes

### 2. Codex CLI

**Install (verified working as deploy user on Droplet):**
```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
export PATH=~/.npm-global/bin:$PATH
npm install -g @openai/codex   # version 0.133.0 at probe time
```

**One-time auth (idempotent):**
```bash
printenv OPENAI_API_KEY | codex login --with-api-key
codex login status   # → "Logged in using an API key - sk-proj-***..."
```

Auth state persists in `~/.codex/auth.json` and `~/.codex/state_5.sqlite`. The `OPENAI_API_KEY` env var alone is **not** sufficient — the CLI specifically requires the persisted login step.

**Autonomous invocation:**
```bash
echo "prompt here" | codex exec --json \
  --skip-git-repo-check \
  --sandbox read-only \
  --dangerously-bypass-approvals-and-sandbox \
  --model gpt-5-codex
```

**Verified JSONL event types (failure path):**
```jsonl
{"type":"thread.started","thread_id":"019e4fbd-119b-70f1-87bc-43b9c5764a13"}
{"type":"turn.started"}
{"type":"error","message":"Quota exceeded. Check your plan and billing details."}
{"type":"turn.failed","error":{"message":"<same message>"}}
```

**Unverified (success path — blocked on OpenAI billing):**
Expected event types based on OpenAI's published Codex docs but **NOT** confirmed at probe time:
- `agent_message` (or `message`) — the assistant's reply text
- `token_count` (or `usage`) — input/output token tallies
- `turn.completed` — successful turn close

**ACTION required before Phase 1.4 execution:** add a payment method to the `agenticos-droplet` OpenAI project at `platform.openai.com → Projects → Billing`. Set the $30/mo hard cap there. Once a single successful Codex call lands, re-run the probe and update `codex_coder.py`'s parser.

### 3. Hermes Agent

- Latest PyPI version: **`0.14.0`**
- Docker image: **`nousresearch/hermes-agent:main`** (Docker Hub; rebuilt on each commit to main)
- Container shape:
  - `ENTRYPOINT ["/usr/bin/tini","-g","--","/opt/hermes/docker/entrypoint.sh"]`
  - `WORKDIR /opt/hermes`
  - `HERMES_HOME=/opt/data` (volume)
  - `HERMES_WEB_DIST=/opt/hermes/hermes_cli/web_dist`
  - Bundles Playwright at `/opt/hermes/.playwright` (so browser-skill capability ships in-image)
  - Default user: `root` (inside container)

**Production deployment** (replaces plan Task 3):
```yaml
# docker-compose.yml additions
services:
  hermes-agent:
    image: nousresearch/hermes-agent:main
    container_name: hermes-agent
    restart: unless-stopped
    ports:
      - "127.0.0.1:7777:7777"   # GUI/REST (Hermes default web port — verify in entrypoint)
    volumes:
      - hermes-data:/opt/data
      - /opt/vault:/opt/vault              # so skills can read/write the vault
      - /opt/agenticos/.env:/opt/data/.env:ro
    environment:
      HERMES_HOME: /opt/data
      AGENTICOS_DB_URL: postgresql://agenticos:${AGENTICOS_DB_PASSWORD}@agenticos-db:5432/agenticos
    env_file:
      - /opt/agenticos/.env
    depends_on:
      agenticos-db:
        condition: service_healthy
    networks:
      - agenticos

volumes:
  hermes-data:
```

**Plugin contract — still unverified.** The `nousresearch/hermes-agent:main` image is enormous (~2.6GB) and ships its own Playwright; getting at its `SkillBase` requires extracting the Python package from the image. Best path is to:
1. Pull from PyPI separately into a local venv on the Mac (no install needed on Droplet — just for reading the source)
2. Read `~/.venv/lib/python3.12/site-packages/hermes_agent/skills/__init__.py` to confirm SkillBase class + decorator shape
3. Update `cost_recorder.py` / `slm_runner.py` / `codex_coder.py` / `slm_router.py` against verified signatures

Defer this to a smaller follow-on spike (~20 min) before Phase 1.1 Task 11 execution.

### 4. OpenViking

- Latest version: **`0.3.19`**
- Docker image: **`ghcr.io/volcengine/openviking:v0.3.19`**
- Container shape:
  - `ENTRYPOINT ["openviking-entrypoint"]`
  - Two relevant binaries inside: **`ov`** (data CLI) and **`openviking-server`** (HTTP server)
  - Expected config file: `/app/.openviking/ov.conf` (env: `OPENVIKING_CONFIG_FILE`)
  - Port `1933` exposed
  - Healthcheck: `curl http://127.0.0.1:1933/health`
- License: AGPL-3.0 — note for compliance

**`ov` CLI subcommands** (verified from `--help`):
- `find` — semantic retrieval (THIS is what `openviking-client.ts.search()` should hit)
- `search` — context-aware retrieval (experimental)
- `read` — L2 (full) content load
- `abstract` — L0 (minimal) content load
- `overview` — L1 (mid) content load
- `add-memory` — write into memory store (commits a session in one shot)
- `session` — session lifecycle (start, commit, archive)
- `add-resource` / `add-skill` — non-memory resources
- `ls` / `tree` / `mkdir` / `mv` / `rm` / `stat` / `find` / `grep` / `glob` — filesystem-paradigm primitives

**Production deployment** (replaces plan Task 2):
```yaml
# docker-compose.yml additions
services:
  openviking:
    image: ghcr.io/volcengine/openviking:v0.3.19
    container_name: openviking
    restart: unless-stopped
    ports:
      - "127.0.0.1:1933:1933"
    volumes:
      - /opt/vault:/app/vault                   # memory root mirrors the Syncthing vault
      - openviking-config:/app/.openviking      # ov.conf lives here
    environment:
      OLLAMA_BASE_URL: http://ollama:11434      # uses sibling Ollama container
      OPENVIKING_CONFIG_FILE: /app/.openviking/ov.conf
    depends_on:
      - ollama
    networks:
      - agenticos
    command: ["openviking-server", "--host", "0.0.0.0", "--port", "1933"]

volumes:
  openviking-config:
```

**`ov.conf` schema — needs verification before Phase 1.0 Task 2 executes.** The Feishu integration code at `openviking/parse/accessors/feishu_accessor.py:56` shows the file is INI/TOML-style with sections like `[feishu]`; the memory section is referenced as `ov_config.memory.extraction_enabled` (so `[memory]` section, `extraction_enabled` field). Action: pull the openviking source from PyPI locally (~20 min spike), read `openviking/config/loader.py` or equivalent, document the full schema, then write the production `ov.conf` template.

### 5. Existing Ollama install confirmed working

(No changes from plan — included for completeness.) Ollama installs via `curl install.sh | sh`, runs as systemd service `ollama.service`, exposes OpenAI-compat REST at `127.0.0.1:11434`. The `--add-host=host.docker.internal:host-gateway` flag lets OpenViking's container reach the host's Ollama.

### 6. Telemetry DB (`agenticos-db`) — no changes

`pg15 + pgvector`, port `127.0.0.1:5432`, healthy and empty. Plan migration applies cleanly.

## Updated plan delta — what to change in `docs/plans/spec1-orchestrator.md`

| Plan task | Original | Updated |
|---|---|---|
| **Task 2** (OpenViking install) | pip + venv + systemd | docker-compose service + ov.conf template |
| **Task 3** (Hermes install) | pip + venv + systemd | docker-compose service + version pin `0.14.0` |
| **Task 4** (Codex install) | unchanged install path | **add `codex login --with-api-key` post-install step**; flag autonomous-call shape |
| **Task 9** (plugin package) | unchanged | Note: plugins still run inside the Hermes container; package needs to be `pip install`'d into the container at build time OR mounted as a volume |
| **Task 13** (codex_coder) | `codex --print --json` parser | **`codex exec --json` parser** with verified event types |
| **Task 18** (openviking-client.ts) | guessed POST `/search` | **Verified endpoint** (TBD — get OpenAPI from running container: `curl http://127.0.0.1:1933/openapi.json`) |

**Add a new** **Task 11.5** **(pre-Phase-1.1 spike, ~20 min):**
- Read Hermes Agent v0.14 source from PyPI locally
- Verify SkillBase / Plugin / hook decorator shapes
- Update Tasks 11–15 with verified Python signatures
- Verify ov.conf schema; update Task 2's config template

## Action items for user (out-of-band)

1. **Enable billing on the OpenAI project `agenticos-droplet`** at `platform.openai.com → Projects → Billing`. Add payment method. Set hard cap $30/mo and soft alert $24/mo. (Without this Codex calls fail with "Quota exceeded".)
2. After (1), re-run the Codex JSONL probe to capture success-path events.

## What's still unknown (and the smallest experiment to resolve each)

| Unknown | How to resolve | Time |
|---|---|---|
| Codex success-path events (`message`, `usage`) | After billing: rerun probe with `echo hi \| codex exec --json` | 2 min |
| Hermes plugin contract (SkillBase API) | `pip install hermes-agent==0.14.0` locally; grep for class `SkillBase` | 20 min |
| OpenViking `ov.conf` full schema | Same pattern; read `openviking/config/loader.py` | 15 min |
| OpenViking REST API shape | Start container with a minimal ov.conf, hit `/openapi.json` | 5 min after config |

All four can be combined into a 45-min Task 11.5 spike during execution, after Phase 1.0 ships the Docker stack.

## Confidence assessment

- **High confidence on:** the Docker pivot, Codex command shape, version pins, REST hostname/port layout, gh auto-merge flow.
- **Medium confidence on:** Hermes plugin contract — we know it exists and is documented (`https://hermes-agent.nousresearch.com/docs/developer-guide/skills`), just haven't verified the v0.14 API surface against the latest plan code.
- **Low confidence on:** OpenViking ov.conf required keys — Feishu integration is referenced but optional; we'll learn the rest by attempting to start the server with a minimal config and iterating on errors.

Spike outcome: ~70% of "best-guess" code in the plan has been replaced with verified shapes. The remaining 30% has a clear cheap path to verification during execution, not later in production.
