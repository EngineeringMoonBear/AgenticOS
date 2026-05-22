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

**Success path — VERIFIED (2026-05-22, after billing enabled):**
```jsonl
{"type":"thread.started","thread_id":"019e503f-4bd8-7d00-b475-97ad8985e32b"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}
{"type":"turn.completed","usage":{"input_tokens":11754,"cached_input_tokens":10624,"output_tokens":6,"reasoning_output_tokens":0}}
```

**Parsing rules for `codex_coder.py`:**
- Assistant text: collect `event.item.text` from every `item.completed` event where `event.item.type == "agent_message"` (multiple items possible per turn; concatenate in order received).
- Token usage: read `event.usage` from `turn.completed`.
  - `input_tokens`: total input including cached.
  - `cached_input_tokens`: subset that hit OpenAI's prompt cache (~90% discount).
  - `output_tokens`: regular generated tokens.
  - `reasoning_output_tokens`: o-series "thinking" tokens (billed as output).

**Pricing implication (worth a schema delta):** the trivial "PONG" reply consumed 11,754 input tokens, 10,624 of which were cache hits. At gpt-5-codex rates that's ≈$0.013 with the cache discount vs ≈$0.13 if all input had been uncached — a 10× difference. The `calls` table should record `cached_input_tokens` separately so cost math is accurate. Add the column to migration `0001_initial_telemetry.sql`:

```sql
ALTER TABLE calls ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;
```

And update `pricing.py` / `pricing.ts` to compute as `(uncached_input * input_rate + cached_input * cached_rate + output * output_rate) / 1_000_000` instead of treating all input as uncached.

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

**Plugin contract — VERIFIED 2026-05-22 via the running container.** Plan's "SkillBase" abstraction does NOT exist. Hermes has THREE distinct extension surfaces, each with a different shape:

### 3a. Hook plugins (`/opt/hermes/plugins/<category>/<name>/`)

- Directory layout:
  ```
  plugins/<category>/<name>/
    ├── plugin.yaml      # manifest
    ├── __init__.py      # implements hook functions
    └── <name>.py        # core logic (convention)
  ```
- `plugin.yaml` declares hooks. Example (`disk-cleanup/plugin.yaml`):
  ```yaml
  name: disk-cleanup
  version: 2.0.0
  description: "Auto-track and clean up ephemeral files."
  hooks:
    - post_tool_call
    - on_session_end
  ```
- Available hooks (verified from `observability/langfuse/plugin.yaml`): `pre_api_request`, `post_api_request`, `pre_llm_call`, `post_llm_call`, `pre_tool_call`, `post_tool_call`, `on_session_end`. Likely also: `on_session_start`, `on_turn_start`, `on_session_switch` — confirm at impl time.
- Plugin loader: `/opt/hermes/hermes_cli/plugins.py`.

### 3b. Memory providers (`/opt/hermes/plugins/memory/<name>/`)

- Subclass `agent.memory_provider.MemoryProvider` (abstract base at `/opt/hermes/agent/memory_provider.py`).
- Required: `name` property, `is_available()`, `initialize(session_id, **kwargs)`.
- Lifecycle: `system_prompt_block()`, `prefetch(query)`, `queue_prefetch(query)`, `sync_turn(user, assistant)`, `shutdown()`, `get_tool_schemas()`, `handle_tool_call()`.
- Optional hooks: `on_turn_start`, `on_session_end`, `on_session_switch`, `on_pre_compress`, `on_memory_write`, `on_delegation`.
- Bundled examples: `honcho/`, `mem0/`, `hindsight/`, `byterover/`, `retaindb/`, `supermemory/`. OpenViking is NOT in the bundled set — it integrates via env-var config in the agent runtime (see Task 3's `hermes-config/config.yaml`), not as a Hermes memory plugin.

### 3c. Tools (`/opt/hermes/tools/<name>.py`)

- Tools register via `registry.register(...)` at module level (source: `/opt/hermes/tools/registry.py`).
- Schema-declared, exposed to the LLM for invocation.

### 3d. Cron jobs

- File-based: `JOBS_FILE` (constants in `/opt/hermes/cron/__init__.py`).
- Scheduler: `cron.scheduler.tick()` — file-locked.

### Plan delta for Tasks 11–15 (REPLAN)

The plan currently treats `cost_recorder`, `slm_router`, `codex_coder`, `slm_runner`, `inbox_watcher` as Hermes "skills" subclassing a non-existent `SkillBase`. Correct mapping:

| Plan task | Old shape | Correct shape |
|---|---|---|
| **11 `cost_recorder`** | Skill subclass | **Hook plugin** at `packages/agenticos-hermes/plugins/cost-recorder/` with `plugin.yaml` declaring `post_llm_call` + `on_session_end`. Plugin dir is bind-mounted into `/opt/hermes/plugins/cost-recorder/` via docker-compose. |
| **12 `slm_runner`** | Skill subclass | **Internal Python module** in our package (`workers/slm_runner.py`). Called by the cron-task code; not a Hermes plugin or tool. |
| **13 `codex_coder`** | Skill subclass | **Internal Python module** (`workers/codex_coder.py`). Wraps `codex exec --json` subprocess. Defer Hermes Tool registration to Spec 2/3 — Phase 1.4 only needs it called from cron-task code. |
| **14 `slm_router`** | Skill subclass | **Internal Python module** (`routing.py`). Pure-function decision tree from spec §5.1. |
| **15 `inbox_watcher`** | Hermes plugin | **Standalone Python daemon** as its own docker-compose service. fsnotify on `/opt/vault/inbox/`. Triggers cron-task entrypoints via subprocess or REST. NOT a Hermes hook plugin. |

### Revised `packages/agenticos-hermes/` layout

```
packages/agenticos-hermes/
  pyproject.toml
  src/agenticos_hermes/
    db.py
    pricing.py
    routing.py           # slm_router (was: skills/slm_router.py)
    workers/
      slm_runner.py      # Ollama wrapper (was: skills/slm_runner.py)
      codex_coder.py     # Codex CLI wrapper (was: skills/codex_coder.py)
    tasks/
      daily_brief.py
      cost_report.py
      inbox_triage.py
  plugins/
    cost-recorder/       # Hermes hook plugin (bind-mounted into Hermes container)
      plugin.yaml
      __init__.py
  daemons/
    inbox-watcher/       # Standalone fsnotify daemon
      Dockerfile
      watcher.py
  tests/
```

Two docker-compose additions for Phase 1.1 (do these when Task 9 lands):
1. Add bind mount on `hermes-agent` service: `- ./packages/agenticos-hermes/plugins/cost-recorder:/opt/hermes/plugins/cost-recorder:ro`
2. Add new service `inbox-watcher` (Python + watchdog) sharing `/opt/vault` mount, depending on `hermes-agent`

### Hermes external auth model (affects Task 17)

Dashboard subcommand mints an ephemeral `secrets.token_urlsafe(32)` at container boot, embeds it in `index.html` as `window.__HERMES_SESSION_TOKEN__`. External callers (our Next.js dashboard) must either:
- (a) Scrape that script tag from a single `GET /` to harvest the token, then use it for all `/api/*` calls, OR
- (b) Wait for a stable-API-key auth mode upstream (open PR / issue territory)

For Phase 1.3 Task 17 we'll start with (a) — single bootstrap fetch on the Next.js side that caches the token, refreshes on 401.

### Confidence

- **High:** Directory layouts, plugin.yaml schema, hook lifecycle event names, MemoryProvider ABC contract, tool-registry pattern, cron scheduler existence, dashboard ephemeral token pattern.
- **Medium:** Exact hook function signatures — verify at impl time via `inspect.signature` against a loaded bundled plugin.
- **Low:** Whether `inbox-watcher` daemon can call back via Hermes REST to create sessions vs going through the cron-tick path. Easiest to try REST first; fall back to cron if it doesn't work.

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

**`ov.conf` schema — VERIFIED 2026-05-22 during Task 2 execution.** Earlier guess (TOML/INI with `[memory]` section) was wrong. Actual format:

- **JSON** — loader is `openviking.server.config.load_json_config` (despite the `.conf` extension)
- All Pydantic models set `extra="forbid"` → no inline comments, unknown keys fail validation
- The `feishu_accessor.py` references to `[feishu]` are misleading — that's just where Feishu *env vars* are documented, not a config-file section

Working minimal `ov.conf` (committed to repo at `openviking-config/ov.conf`):
```json
{
  "default_account": "agenticos",
  "default_user": "deploy",
  "default_agent": "default",
  "server": {
    "host": "0.0.0.0",
    "port": 1933,
    "workers": 1,
    "cors_origins": ["*"],
    "auth_mode": "api_key",
    "root_api_key": "__OPENVIKING_ROOT_API_KEY__"
  },
  "storage": { "workspace": "/app/.openviking/data" },
  "embedding": {
    "dense": {
      "provider": "ollama",
      "model": "nomic-embed-text",
      "api_base": "http://ollama:11434/v1"
    }
  },
  "memory": { "extraction_enabled": true }
}
```

Notes:
- `embedding.dense.api_base` MUST end with `/v1` — without it, the OpenAI-compat path hits a 404 and the circuit breaker trips
- `server.auth_mode = "dev"` is rejected for non-loopback hosts (and a Docker container is non-loopback by definition), so `api_key` mode is required in production
- `root_api_key` placeholder is substituted at first boot by cloud-init with an `openssl rand -hex 32` value, persisted in `/opt/agenticos/.env` as `OPENVIKING_ROOT_API_KEY`

**REST surface — VERIFIED via `/openapi.json` of the running container (85 paths total):**

Auth: every `/api/v1/*` endpoint requires `Authorization: Bearer <OPENVIKING_ROOT_API_KEY>`. The `/health` endpoint is auth-free.

Key endpoints for Phase 1.3's `openviking-client.ts`:

| Concern | Path | Method |
|---|---|---|
| Health | `/health` | GET |
| Search (semantic) | `/api/v1/search/find` | POST |
| Search (context-aware) | `/api/v1/search/search` | POST |
| Search (pattern) | `/api/v1/search/grep`, `/api/v1/search/glob` | POST |
| Read content (full) | `/api/v1/content/read` | GET |
| Read content (abstract / overview) | `/api/v1/content/abstract`, `/api/v1/content/overview` | GET |
| Write content | `/api/v1/content/write` | POST |
| Filesystem ops | `/api/v1/fs/{ls,tree,mkdir,mv,stat}` | various |
| Sessions | `/api/v1/sessions` `/api/v1/sessions/{id}` `/api/v1/sessions/{id}/{commit,messages,extract,context}` | various |
| Resources | `/api/v1/resources` | POST/GET |
| Skills (OV-managed, not Hermes skills) | `/api/v1/skills` | POST/GET |
| Memory stats | `/api/v1/stats/memories` | GET |

**Action for Plan Task 18 (`openviking-client.ts`):** earlier plan code targeted `POST /search` with no auth. Correct shape is `POST /api/v1/search/find` with `Authorization: Bearer ${OPENVIKING_ROOT_API_KEY}` header. Update during Phase 1.3 execution.

**Idle memory footprint (verified):** 273 MiB resident with both Ollama + agenticos-db also running. Slightly above the earlier 200 MiB estimate but well under the 500 MiB flag threshold. Total stack idle: ~743 MiB on a 4 GiB Droplet → ~3.3 GiB free for Hermes + Codex + actual model inference.

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
| **Task 18** (openviking-client.ts) | guessed POST `/search` | **Verified:** `POST /api/v1/search/find` with `Authorization: Bearer ${OPENVIKING_ROOT_API_KEY}`. See §4 "REST surface" above for the full path table. |

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
<!-- automerge-test 2026-05-22T12:49:00-04:00 -->
