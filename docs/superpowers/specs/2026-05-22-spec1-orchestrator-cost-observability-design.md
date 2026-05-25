# Spec 1 — Orchestrator + Cost Observability

> **Status:** Approved-pending-review (drafted 2026-05-22)
> **Supersedes (partial):** Sections 5–6 of `2026-05-20-agenticos-foundation-v2-design.md` (memory + scheduler)
> **Companion ADR:** `docs/adr/0005-orchestrator-hermes-headless.md` (to be written alongside)

**Goal:** Replace the foundation-v2 plan's homemade scheduler + Honcho memory stack with Hermes Agent (headless orchestrator), OpenViking (filesystem-backed memory over `/opt/vault`), Codex CLI + local SLMs as the two-tier worker pool, and a cost-observability surface that makes spend predictable.

**Non-goals (deferred to later specs):**
- Memory curator / "dreaming" eviction (Spec 4 if/when staleness measurably hurts)
- GitHub Actions sandbox-coder delegation (Spec 2)
- Per-domain SLM routing for marketing / video / farming / farm-ops (Spec 3)
- Visual design pass (last work-item of Spec 1's implementation phase)

---

## 1. Why this exists

The foundation-v2 spec assumed (a) Claude Code's Max-OAuth headless mode would be free for autonomous use indefinitely and (b) Honcho would be a black-box memory store. Both broke:

- **Anthropic's 2026-06-15 billing change** moves `claude --print` + Agent SDK off the Max chat subscription onto separately-metered API-rate credits. Headless 24/7 Claude on a $200/mo sub stops being economically viable.
- **Honcho v2** turned out to require eager startup-time LLM-provider initialization (Anthropic + Google + OpenAI keys) even with `EMBED_MESSAGES=False`. Self-hosting it without paid API access fails.
- **OpenAI's Codex CLI** has the same pattern as Claude's headless mode — OpenAI explicitly directs autonomous/CI use to API-key billing rather than subscription auth.

Spec 1 accepts that **autonomous LLM use carries metered cost** and designs around budget caps + telemetry rather than fighting the economics. It also pivots memory to **OpenViking**, whose filesystem paradigm aligns natively with the existing Obsidian vault + Syncthing pipeline.

---

## 2. Architecture

```
                       Cloudflare Access (Google SSO)
                                    │
                          ┌─────────▼─────────────┐
                          │  AgenticOS Dashboard   │  Next.js 16, App Platform
                          │  • Task feed (SSE)     │
                          │  • Cost views (3-tier) │
                          │  • Brief reader        │
                          │  • Budget controls     │
                          └─────────┬─────────────┘
                                    │ REST (VPC private)
                       ┌────────────┴───────────────────────────┐
                       │  Droplet (s-2vcpu-4gb)                  │
                       │                                         │
                       │  ┌────────────────────────────────┐    │
                       │  │  Hermes Agent (FastAPI)        │    │  systemd
                       │  │   • cron scheduler             │    │  127.0.0.1:7777
                       │  │   • skill registry             │    │
                       │  │   • session manager            │    │
                       │  │   • inbox-watcher plugin       │    │
                       │  │   • slm-router skill           │    │
                       │  │   • codex-coder skill          │    │
                       │  │   • slm-runner skill           │    │
                       │  │   • cost-recorder hook         │    │
                       │  └─┬──────┬──────┬───────┬───────┘    │
                       │    │      │      │       │             │
                       │  ┌─▼─┐  ┌─▼──┐ ┌─▼───┐ ┌─▼──────────┐ │
                       │  │Cdx│  │Oll │ │OV   │ │agenticos-db│ │
                       │  │CLI│  │ama │ │REST │ │PG (compose)│ │
                       │  └─┬─┘  └─┬─┘ └─┬───┘ └────────────┘ │
                       │    │      │     │                     │
                       │  OpenAI Local /opt/vault              │
                       │   API   GGUF  (Syncthing-paired)      │
                       │                                       │
                       │  ┌───────────────────────────────┐   │
                       │  │  1Password SA hourly timer    │   │  systemd timer
                       │  │  refreshes /opt/agenticos/.env │   │
                       │  └───────────────────────────────┘   │
                       └───────────────────────────────────────┘
                                    ↕ Tailscale
                            Mac + Obsidian + Syncthing
```

**Three layers, three runtimes:**
1. **UI layer** — AgenticOS dashboard on App Platform. Public, Cloudflare-Access-gated, read-only-ish (it can trigger manual tasks and change budget but doesn't run them).
2. **Orchestration layer** — Hermes Agent as a native systemd service on the Droplet, bound to `127.0.0.1:7777`. Owns scheduling, skill registry, session lifecycle, telemetry emission.
3. **Worker layer** — Codex CLI (subprocess invoked by a skill), Ollama daemon (SLMs), OpenViking (memory), `agenticos-db` (Postgres for telemetry rows).

**Inter-layer comms:**
- Dashboard → Hermes: REST over the DO VPC private network (App Platform's VPC attachment makes the Droplet's private IP reachable from the dashboard).
- Hermes → workers: localhost.
- Hermes → OpenAI: outbound HTTPS, key in `OPENAI_API_KEY` from `.env`.

---

## 3. Components

### 3.1 Hermes Agent (orchestrator)

- **Install:** `pip install hermes-agent` via cloud-init; systemd unit `hermes-agent.service` running as `deploy` user.
- **Bind:** `127.0.0.1:7777` (no public exposure; UFW rule confirms).
- **Config source of truth:** `~/.hermes/config.yaml`, templated by Terraform → cloud-init.
- **Skills enabled at install:**
  - `inbox-watcher` (Hermes plugin we author) — fsnotify on `/opt/vault/inbox/`
  - `slm-router` — picks Codex vs Ollama per task; logic in §5.1
  - `codex-coder` — wraps `codex --print` subprocess; provides task isolation
  - `slm-runner` — invokes Ollama HTTP API (OpenAI-compat)
  - `cost-recorder` — global hook that writes a row to `agenticos-db` after every paid call
  - `openviking-memory` — Hermes's built-in OpenViking memory provider plugin
- **Cron jobs defined in config:**
  - `daily-brief` — `0 7 * * *` America/New_York
  - `cost-report` — `0 23 * * *` America/New_York (end-of-day rollup)
- **Memory provider:** OpenViking via the bundled plugin; `OPENVIKING_ENDPOINT=http://127.0.0.1:1933`.
- **Auxiliary LLM** (for Hermes's internal use — session naming, light routing decisions): `gpt-4o-mini` via the same `OPENAI_API_KEY`.

### 3.2 OpenViking (memory)

- **Install:** `pip install openviking` via cloud-init; `openviking-server init --non-interactive --memory-root /opt/vault` to seed config without the wizard.
- **Service:** systemd unit `openviking.service`; binds `127.0.0.1:1933`.
- **Memory root:** `/opt/vault` — same directory Syncthing pairs with the Mac. OpenViking's filesystem paradigm means notes Hermes commits as memories are visible as `.md` files in Obsidian, and vice-versa.
- **Embedding model:** `nomic-embed-text` (served by Ollama at `127.0.0.1:11434`). Configured via OpenViking's `embedding.transport=ollama` setting.
- **Lifecycle:** No auto-curation. Relies on built-in `HOTNESS_ALPHA=0.2` recency-weighted retrieval. Storage grows; cobwebs sink in retrieval rank.

### 3.3 Ollama (local SLM tier)

- **Install:** `curl -fsSL https://ollama.com/install.sh | sh` via cloud-init.
- **Service:** systemd unit (Ollama ships its own); binds `127.0.0.1:11434`.
- **Models pulled at install (cloud-init `ollama pull` for each):**
  - `qwen2.5:3b` (~2.0 GB) — general routine: classification, summary, extraction, structured-output
  - `nomic-embed-text` (~270 MB) — embeddings for OpenViking
- **Memory budget:** ~2.3 GB resident across both models (out of 4 GB Droplet). Leaves ~1 GB for Hermes + OpenViking + node.js dashboard process running locally for dev.
- **Model upgrade path:** `ollama pull <new>` + change Hermes routing config; no Droplet rebuild needed.

### 3.4 Codex CLI (paid coder tier)

- **Install:** `npm install -g @openai/codex` via cloud-init (user-scoped npm prefix to mirror the existing Claude install pattern).
- **Auth:** API-key-only — `OPENAI_API_KEY` from `/opt/agenticos/.env`. No `codex login` step needed for autonomous use.
- **Default model:** `gpt-5-codex` (latest Codex-tier model at time of Spec 1; updatable in Hermes config).
- **Invocation:** Hermes's `codex-coder` skill spawns `codex --print --json <prompt>` as a subprocess, captures stdout, parses tool-call results.
- **Sandboxing:** Codex runs as `deploy` user in `/opt/agenticos/work/<task-id>/` — Hermes creates the per-task scratch dir and `cd`s the subprocess into it. Prevents one task's work from polluting another's.

### 3.5 Claude Code (fallback)

- **Install:** Already in cloud-init (existing); stays.
- **Routing:** Not in the default `slm-router` decision tree. Invocable explicitly via `POST /api/run-claude` from the dashboard for manual fallback. Skill name: `claude-coder` (registered but unused by automated routing).
- **Auth:** Existing `claude /login` OAuth (manual, one-time). Will be metered post 2026-06-15 — we accept this since it's a manual escape hatch, not the autonomous path.

### 3.6 agenticos-db (telemetry)

- **Substrate:** Postgres 15 + pgvector image (already running in `docker-compose.yml`).
- **Schema (Spec 1 introduces):**

```sql
-- A task is one logical unit of agent work, kicked off by a trigger.
CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,                      -- 'triage-2026-05-22-14-30-12'
  kind          TEXT NOT NULL,                         -- 'inbox-triage' | 'daily-brief' | 'cost-report' | …
  trigger       TEXT NOT NULL,                         -- 'fsnotify:/opt/vault/inbox/x.md' | 'cron:daily-brief'
  status        TEXT NOT NULL,                         -- 'queued' | 'running' | 'done' | 'failed' | 'budget-blocked'
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  cost_cents    INTEGER NOT NULL DEFAULT 0,            -- rollup of all sessions+calls under this task
  error         TEXT,                                  -- nullable
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb     -- task-kind-specific (e.g. {"file": "x.md"})
);

-- A Hermes session under a task — a coherent agent conversation.
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,                      -- Hermes-supplied session id
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  hermes_skill  TEXT NOT NULL,                         -- 'codex-coder' | 'slm-runner' | 'inbox-watcher' | …
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  cost_cents    INTEGER NOT NULL DEFAULT 0
);

-- An atomic LLM call inside a session.
CREATE TABLE calls (
  id            BIGSERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,   -- denormalized for fast task-cost rollup
  provider      TEXT NOT NULL,                         -- 'openai' | 'ollama'
  model         TEXT NOT NULL,                         -- 'gpt-5-codex' | 'qwen2.5:3b' | …
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_cents    INTEGER NOT NULL DEFAULT 0,            -- 0 for local SLMs
  latency_ms    INTEGER NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb     -- {"finish_reason": "...", "cache_hit": false}
);

CREATE INDEX ON tasks (status, started_at DESC);
CREATE INDEX ON calls (task_id, occurred_at DESC);
CREATE INDEX ON calls (occurred_at DESC) WHERE provider = 'openai'; -- for daily-spend queries

-- Budget config (single row; updatable from dashboard).
CREATE TABLE budget (
  id                   SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monthly_cap_cents    INTEGER NOT NULL DEFAULT 3000,  -- $30
  soft_alert_pct       SMALLINT NOT NULL DEFAULT 80,
  reset_day_of_month   SMALLINT NOT NULL DEFAULT 1
);
INSERT INTO budget DEFAULT VALUES;
```

- **Connection:** From dashboard via `127.0.0.1:5432` (when running the Next.js dev locally on the Droplet) or — in production — via the DO VPC to the Droplet's private IP. From Hermes, always via localhost.
- **Migrations:** Use `node-pg-migrate` from the dashboard repo; runs at App Platform deploy time and at Droplet boot via cloud-init.

### 3.7 AgenticOS Dashboard (UI)

- **Brownfield reuse:** Existing Next.js 16 app at `apps/dashboard/`. Existing `lib/agent/` scaffold gets adapted, not deleted:
  - `lib/agent/honcho-client.ts` → renamed/rewritten as `lib/agent/hermes-client.ts` (talks to Hermes REST)
  - New `lib/agent/openviking-client.ts` for direct memory queries
  - New `lib/cost/db.ts` for Postgres telemetry reads
  - Existing `lib/agent/spawn.ts` repointed at Hermes's `POST /api/tasks` instead of direct Codex/Claude invocation
- **New routes:**
  - `GET /api/tasks` (SSE) — live task feed
  - `GET /api/tasks/:id` — task detail with sessions + calls drill-down
  - `POST /api/tasks` — manual task trigger
  - `GET /api/cost/today` `/api/cost/month` `/api/cost/forecast` — three views of spend
  - `GET /api/budget` `PUT /api/budget` — read/update cap + alert thresholds
- **DNS-rebinding middleware** (`apps/dashboard/proxy.ts`): unchanged; `ALLOWED_HOSTS` already covers production domain.
- **Visual pass:** Deferred to last work-item. Existing functional styling stays during build-out.

### 3.8 Secret refresh (1Password SA + systemd timer)

- **Cloud-init writes** `/etc/1password-cli/token` (`chmod 600 root:root`) using the `1password-production-terraform-key` value, templated by Terraform at apply-time.
- **Systemd timer** `agenticos-secrets-refresh.timer` runs `/opt/agenticos/bin/refresh-secrets.sh` hourly.
- **Refresh script:**
  ```bash
  #!/bin/bash
  set -euo pipefail
  export OP_SERVICE_ACCOUNT_TOKEN=$(cat /etc/1password-cli/token)
  TMP=$(mktemp)
  trap "rm -f $TMP" EXIT
  KEEP="^AGENTICOS_DB_PASSWORD="       # never overwrite the generated db password
  grep -E "$KEEP" /opt/agenticos/.env > "$TMP" || true
  echo "OPENAI_API_KEY=$(op item get 'AgenticOS Infra' --vault 'Goldberry Grove - Admin' --fields openai_api_key --reveal)" >> "$TMP"
  echo "LLM_OPENAI_API_KEY=$(op item get 'AgenticOS Infra' --vault 'Goldberry Grove - Admin' --fields openai_api_key --reveal)" >> "$TMP"
  chmod 600 "$TMP"
  mv "$TMP" /opt/agenticos/.env
  chown deploy:deploy /opt/agenticos/.env
  systemctl reload-or-restart hermes-agent.service
  ```
- **Why hourly:** Balances key-rotation propagation (you rotate, it's live within an hour) against unnecessary churn. Adjustable.

---

## 4. Day-1 autonomous tasks

### 4.1 Inbox triage

- **Trigger:** fsnotify `IN_CLOSE_WRITE` on `/opt/vault/inbox/*.md`, 5s debounce, file-size-stable check.
- **Flow:**
  1. New `.md` lands (typically via Syncthing from Mac).
  2. `inbox-watcher` skill opens task, kind=`inbox-triage`.
  3. `slm-router` classifies as "lightweight classification" → routes to Qwen 2.5 3B.
  4. SLM returns `{ category, subfolder, summary }` JSON.
  5. Hermes moves file to `/opt/vault/<category>/<subfolder>/<name>.md`, writes summary to sidecar `/opt/vault/<category>/<subfolder>/.summaries/<name>.md`.
  6. Hermes commits an OpenViking memory record (auto-extracted entities).
  7. Telemetry rows written: 1 task, 1 session, 1 call ($0.00 — local SLM).
  8. Dashboard SSE pushes the task event.
- **Cost expectation:** $0 / event (Ollama-only). Hard ceiling: if SLM returns malformed JSON 3× in a row, escalates to Codex one-shot with 1k-token cap.

### 4.2 Daily morning brief

- **Trigger:** Cron `0 7 * * *` America/New_York.
- **Flow:**
  1. `daily-brief` task fires.
  2. Hermes session queries OpenViking for: last 24h memories, pinned reminders, open todos.
  3. Hermes session queries `agenticos-db` for: yesterday's tasks (count + status + cost).
  4. Routing: this is a synthesis task with multi-source context — `slm-router` routes to Codex (`gpt-5-codex` or `gpt-5` depending on context-length).
  5. Codex generates brief, saves to `/opt/vault/daily-briefs/YYYY-MM-DD.md`.
  6. Telemetry written.
- **Cost expectation:** ~$0.10–$0.30 per brief. ~$3–$9/month.

### 4.3 Cost report

- **Trigger:** Cron `0 23 * * *` America/New_York.
- **Flow:**
  1. `cost-report` task fires.
  2. Reads `agenticos-db` for today's rollup (per task, per kind, per provider).
  3. Computes month-to-date vs budget, projected month-end based on 30-day moving average.
  4. SLM (Qwen 2.5 3B) formats the markdown.
  5. Writes `/opt/vault/cost-reports/YYYY-MM-DD.md`.
  6. If budget exceeded soft-alert threshold (80% by default), prepends an alert section.
  7. Telemetry written (this task itself costs ~$0.00).
- **Cost expectation:** $0 (all local).

---

## 5. Cost observability

### 5.1 `slm-router` skill logic

Decision tree, in order:

1. **Hard budget block:** If month-to-date `cost_cents` ≥ `budget.monthly_cap_cents`, force SLM-only for any paid call. Return a flag in result so cost-report can flag the day.
2. **Task-kind override:** Some kinds are SLM-only by config (`inbox-triage`, `cost-report`). Some are Codex-by-default (`daily-brief`).
3. **Context-size heuristic:** If prompt + retrieved context > 16k tokens, force Codex (SLMs lose coherence at long context).
4. **Complexity heuristic:** If the calling skill annotates `complexity: "low"`, force SLM. If `"high"`, force Codex. Default `"auto"` falls through.
5. **Auto path:** Default to SLM (Qwen 2.5 3B). If SLM-returned JSON fails schema validation 3× consecutively, escalate to Codex.

### 5.2 `cost-recorder` hook

Runs after every Hermes session ends.

- Inserts a `calls` row per LLM call made during the session (with provider, model, token counts, computed `cost_cents`).
- Updates session `cost_cents` rollup.
- Updates task `cost_cents` rollup (denormalized via the `calls.task_id` index).

Pricing tables for `cost_cents` computation live in `apps/dashboard/lib/cost/pricing.ts` and are checked into version control (updated when OpenAI changes prices; commit acts as the audit trail).

### 5.3 Dashboard cost views

Three nested views, drill-down navigation:

| View | Granularity | What you see |
|---|---|---|
| **Today** | Per-task rows | Task kind, cost, status, time; click → task detail |
| **This month** | Per-day bars + per-kind pie chart | Spend trend, percentage by task kind, MTD vs cap |
| **Forecast** | 30-day moving average → projected month-end | "At current pace you'll spend $24.30 by 2026-05-31 — 81% of $30 cap" |

Task detail page expands to show **per-session** rows; clicking a session expands to **per-call** rows. Three-tier drill-down matching the data model.

### 5.4 Budget enforcement

- **80% soft alert:** Top-of-dashboard banner appears (orange), cost-report adds a warning section.
- **100% hard refuse:** `slm-router` returns `budget-blocked` for any task that would invoke Codex. Tasks complete via SLM-only path if possible; tasks that explicitly require Codex (e.g., `daily-brief`) are marked `failed` with `error="budget-blocked"`. Manual override available via dashboard's `PUT /api/budget` (raise cap) or `POST /api/tasks/:id/retry?force=true`.
- **Monthly reset:** A cron at `0 0 1 * *` clears the soft-alert dismissal; the cap itself never auto-resets (you set it, it stays).

---

## 6. Data flow — happy-path traces

### 6.1 Inbox triage (recurring, ~5–20× per day)

```
Mac: save inbox/winter-forage.md
    ↓ Syncthing replicates (~2s)
Droplet: /opt/vault/inbox/winter-forage.md exists
    ↓ fsnotify IN_CLOSE_WRITE
inbox-watcher: debounce 5s, file-size-stable, create task ⟨id=triage-…⟩
    ↓ Hermes session_id assigned
slm-router: kind=inbox-triage ∧ context<16k ∧ no override → Ollama
    ↓ HTTP POST 127.0.0.1:11434/v1/chat/completions  model=qwen2.5:3b
SLM returns: {"category":"farming","subfolder":"forage","summary":"…"}
    ↓ Hermes
mv /opt/vault/inbox/winter-forage.md /opt/vault/farming/forage/winter-forage.md
echo "$summary" > /opt/vault/farming/forage/.summaries/winter-forage.md
    ↓ Hermes
OpenViking POST /memories  (auto-extracted entities from full text)
    ↓ cost-recorder hook
INSERT INTO tasks (…), sessions (…), calls (provider='ollama', cost_cents=0, …)
    ↓ Hermes SSE emitter
Dashboard SSE subscribers get TaskCreated event
    ↓ Syncthing replicates new locations
Mac: file now appears in Obsidian under farming/forage/
```

End-to-end, ~6–10 seconds from save to dashboard reflection.

### 6.2 Daily morning brief (1× per day)

```
07:00 ET cron fires
    ↓ Hermes
task ⟨id=brief-2026-05-22⟩, kind=daily-brief
    ↓ session
OpenViking POST /search  scope=last-24h, top_k=20
agenticos-db SELECT yesterday's task summary
    ↓ slm-router: kind=daily-brief → Codex (config override)
codex-coder skill: spawn codex --print --json
    ↓ Codex CLI hits OpenAI API
gpt-5-codex returns brief
    ↓ Hermes
write /opt/vault/daily-briefs/2026-05-22.md
OpenViking POST /memories  (commit the brief as a memory)
    ↓ cost-recorder hook
INSERT INTO calls (provider='openai', model='gpt-5-codex',
                   input_tokens=8421, output_tokens=1124, cost_cents=18, …)
    ↓ Syncthing → Mac → Obsidian
```

End-to-end, ~15–60 seconds. Cost: ~$0.18.

---

## 7. Error handling

| Failure mode | Detection | Response |
|---|---|---|
| OpenAI rate-limit (429) | Codex CLI exits non-zero with structured error | Exponential backoff 5s/30s/5m. Final fail → task `failed` with retry button. |
| OpenAI 5xx | Same as above | Same as above. |
| OpenAI invalid key | 401 from API | Task fails immediately. Dashboard surfaces banner: "OPENAI_API_KEY invalid — check 1Password item." No automatic retry. |
| Budget cap exceeded | `slm-router` checks before invoking | Task either completes SLM-only or fails with `budget-blocked`. Soft-alert banner shows in dashboard. |
| Ollama unreachable | HTTP timeout | systemd auto-restart Ollama. Tasks pending requeue with `awaiting-model` status; resume when health check passes. After 5min still down, escalate to Codex if budget allows. |
| OpenViking unreachable | HTTP timeout | Task continues (memory commit fire-and-forget); log warning; dashboard degraded-mode banner. |
| Syncthing not-yet-propagated | File grows during read | 5s debounce + file-size-stable check on inbox-watcher prevents premature processing. |
| Hermes crash | systemd unit reports failure | Auto-restart (`Restart=on-failure`). Pending tasks persist in Postgres `queued` state and resume. |
| agenticos-db down | Connection refused | Hermes batches telemetry to local JSONL file (`/var/log/agenticos/pending-telemetry.jsonl`); flushes when db back. Dashboard cost views show "stale" indicator. |
| 1P SA token revoked | `op` returns 401 | refresh-secrets timer fails, alerts via journalctl + dashboard banner ("secret refresh failed since YYYY-MM-DD"). Existing `.env` keeps working until OpenAI key rotates. |

---

## 8. Testing

### 8.1 Unit (per skill / module, fast, mocked)

- `inbox-watcher.test.ts` (Hermes plugin in Python — `pytest`): given a synthetic fsnotify event, asserts task created with correct shape.
- `slm-router.test.py`: matrix of `(task_kind, complexity, context_size, budget_remaining)` → expected route.
- `cost-recorder.test.py`: given canned LLM-call payloads, asserts correct rows inserted.
- `lib/cost/pricing.test.ts` (dashboard, `vitest`): pricing math is purely functional.
- `lib/agent/hermes-client.test.ts` (`vitest` + `msw` for HTTP mocking): client correctly serializes/deserializes Hermes REST.

### 8.2 Integration (Docker Compose, slow but full stack)

- `make test-integration` brings up `hermes + ollama (with TinyLlama) + openviking + agenticos-db` in a compose override file.
- **inbox-triage e2e:** write a fake `.md` to a test inbox dir, assert task completes in < 60s, assert telemetry rows match expected shape, assert OpenViking has the memory.
- **daily-brief e2e:** seed db + OpenViking with fixtures, manually fire the cron, assert brief file written and contains expected sections.
- **budget-cap e2e:** set monthly_cap_cents=1, fire a task that would invoke Codex, assert `budget-blocked` and SLM-only fallback.

### 8.3 Acceptance (real Droplet, end-to-end)

- Drop a real note in `~/AgenticOS-Vault/inbox/` on the Mac.
- Within 30s: dashboard's task feed shows the new triage task.
- Within 60s: file appears in `farming/forage/` on the Mac via Syncthing.
- Cost view shows the new $0.00 row.

### 8.4 Cost-telemetry golden fixtures

- A locked-down test fixture maps `(model, input_tokens, output_tokens) → expected_cost_cents` for every model on the allowlist. Pricing changes break this test — that's the audit trail.

---

## 9. Cloud-init / Terraform automation discipline

| Item | Mechanism | Manual fallback |
|---|---|---|
| Ollama daemon | cloud-init: `curl install + systemctl enable --now` | — |
| Ollama models pulled | cloud-init: `ollama pull qwen2.5:3b nomic-embed-text` | — |
| OpenViking install + service | cloud-init: `pip install openviking + non-interactive init + systemd unit + enable --now` | — |
| Hermes Agent install + service | cloud-init: `pip install hermes-agent + config.yaml templated by Terraform + systemd unit + enable --now` | — |
| Hermes config.yaml | Terraform template, includes API key references via `${env('OPENAI_API_KEY')}` resolved at Hermes startup from `.env` | — |
| Codex CLI install | cloud-init: `npm install -g @openai/codex` (deploy user, user-scoped npm prefix — same pattern as the existing Claude install) | — |
| `agenticos-db` Postgres | docker-compose (already deployed) | — |
| Schema migrations | dashboard repo's `node-pg-migrate` runs at App Platform deploy AND at Droplet boot via cloud-init | — |
| UFW rules for new ports | cloud-init: deny incoming on 7777, 11434, 1933 from non-localhost; allow on localhost only (Hermes/Ollama/OpenViking already bind to 127.0.0.1, this is belt-and-suspenders) | — |
| Syncthing folder pairing | cloud-init: first-boot script uses Syncthing REST API + Tailscale-resolved Mac address | — |
| 1Password SA token | Terraform reads `1password-production-terraform-key` from 1P at apply-time, templates into `/etc/1password-cli/token` via cloud-init | — |
| Hourly secret refresh | systemd timer `agenticos-secrets-refresh.timer` running `refresh-secrets.sh` | — |
| OpenAI API key seeding | hourly refresh from 1P | — |
| Claude `/login` OAuth | **MANUAL** (one-time, interactive only) | n/a — interactive OAuth is irreducible |
| Cloudflare Access Google IdP | **MANUAL** (one-time, web console) | — |

**Net manual steps remaining on a clean `terraform destroy && terraform apply`:** 1 (claude /login, optional).

---

## 10. UI direction (deferred, captured for later)

**Aesthetic reference:** KUN AI Operating System dashboard layout — slim icon-only left sidebar, glass KPI tiles, list-with-progress-bars rows, system-status pill bottom-left, dense modern info hierarchy.

**Palette pivot:** Forest + autumn instead of cool purple ombre. Working palette:

| Role | Color | Use |
|---|---|---|
| Base ombre — deep | `#0e1f1a` (pine bark) | Background top-left |
| Base ombre — mid | `#1a3a2e` (forest floor) | Background center |
| Base ombre — warm | `#3a4a2e` (moss into harvest) | Background lower-right |
| Accent — primary | `#c2620b` (harvest orange) | KPIs, primary buttons |
| Accent — alert | `#a83a1a` (madder red) | Errors, over-budget |
| Accent — okay | `#7fb069` (new growth) | Healthy status, deltas up |
| Accent — info | `#d4a574` (oak amber) | Neutral notifications |
| Surface — glass | `rgba(255,255,255,0.06)` over `rgba(0,0,0,0.30)` + `backdrop-blur-md` | KPI tiles, list rows |
| Text — primary | `#f4ead5` (parchment) | Body |
| Text — muted | `#a89c80` (driftwood) | Labels |

**Implementation phasing:** Last work-item of Spec 1. Functional ugly dashboard ships first; the visual pass is a single chunk of work after orchestrator + cost observability are working.

---

## 11. Open questions — RESOLVED at implementation time

1. **OpenViking's `compact` operation** — Resolved: not enabled; the Phase 1.1-1.4 flows don't generate enough memory churn to warrant it. OpenViking idles at 274 MiB resident with default settings (`HOTNESS_ALPHA=0.2`, no scheduled compaction). Revisit if memory growth becomes a real signal.

2. **gpt-5-codex pricing exact rates** — Resolved: `pricing.py` rate card last reviewed 2026-05-22 and matches `https://openai.com/api/pricing` at that date. **Cron-driven Codex calls currently record `cost_cents=0` because they don't route through the Hermes `post_llm_call` hook** (which the cost-recorder plugin observes). Follow-up: call `pricing.cost_cents()` inline in `tasks/daily_brief.py` after each Codex call. Tracked separately as a known gap; daily-brief hasn't fired yet (next: 07:00 ET tomorrow).

3. **Hermes plugin API stability** — Resolved: contract documented in `docs/superpowers/specs/spec1-verified-api-shapes.md` §3. Hermes version pinned via custom overlay image (`agenticos/hermes-agent:local` built on each Droplet from `nousresearch/hermes-agent:main` — PR #84). Plugin hook signatures verified against `/opt/hermes/plugins/observability/langfuse/__init__.py:801` (PR #66).

4. **Cloudflare Access in front of dashboard's SSE endpoint** — Resolved by Phase 1.3 not using SSE. Task 20 (`/api/tasks`) was simplified to GET+POST polling instead, since the plan's SSE complexity was YAGNI for a single-operator system. Polling at 5s via React Query is plenty responsive at our task rate (~1 inbox-triage per Mac note + 2 cron firings per day).

5. **Droplet RAM budget headroom** — Resolved during Phase 1.0 deploys: 4 GiB Droplet runs comfortably at ~835 MiB idle with all 6 containers up (agenticos-db, ollama, openviking, hermes-agent, hermes-gateway, inbox-watcher). Acceptance test (Task 27) showed end-to-end triage doesn't push past 2 GiB resident even with Qwen 2.5 3B loaded for the SLM call. No Droplet upsize needed.

### Acceptance results (2026-05-24)

End-to-end test (PR #86) ran successfully after the `completed_at`→`ended_at` fix (PR #87):

- **Pipeline latency:** Mac → Syncthing (6s) → inbox-watcher → SLM (6s) → file relocated + summary written → Syncthing back to Mac (9s). Total: ~21s.
- **Cost:** $0.00 (local Ollama via Qwen 2.5 3B).
- **Classification accuracy:** Qwen correctly identified "farming/pasture-management" from a 303-byte test note. Subfolder slug auto-generated.
- **Telemetry:** 1 `tasks` row + 1 `sessions` row + 1 `calls` row, all with correct schema + cost data.
- **Real bug caught:** Three cron tasks had `UPDATE tasks SET completed_at = now()` but the column is `ended_at`. Unit tests mocked `connect()` and missed it; acceptance hit the real Postgres and surfaced it immediately. Fixed via PR #87.

### Cron-task validation

- **cost-report (23:00 ET):** scheduled, will fire ~3 hours after this doc's writing. First real signal on whether the gateway sidecar's scheduler-tick is healthy.
- **daily-brief (07:00 ET):** scheduled, fires tomorrow morning. First real Codex API call from production. Watch for: (a) Codex auth still valid, (b) cost row recorded with non-zero `cost_cents`, (c) brief file appears in `/opt/vault/daily-briefs/`.
- **inbox-triage:** validated end-to-end via the acceptance test.

---

## 12. Migration from current state

The existing Droplet, dashboard, and infrastructure are kept. Spec 1's implementation work is layered on top:

- **Already done (this brainstorm session):** Honcho stack decommissioned, `agenticos-db` Postgres container running on Droplet, repo updated to deploy that on fresh builds, 1Password Service Account token added, OpenAI project-scoped API key added to `.env` on the Droplet.
- **Phase 1.0 (orchestrator install):** Cloud-init updates for Ollama + OpenViking + Hermes; Codex CLI install; first-boot scripts.
- **Phase 1.1 (skills):** Author + install Hermes skills (inbox-watcher, slm-router, codex-coder, slm-runner, cost-recorder).
- **Phase 1.2 (telemetry schema):** Migrations + Hermes hook for cost-recording.
- **Phase 1.3 (dashboard rewire):** Adapt `lib/agent/`, add cost API routes, add task feed SSE.
- **Phase 1.4 (autonomous tasks):** Wire up the three day-1 tasks; integration tests.
- **Phase 1.5 (acceptance):** Real-vault, real-Codex e2e test.
- **Phase 1.6 (visual pass):** Forest+autumn palette + KUN-AI-style layout.

Implementation plan to follow in `docs/plans/spec1-orchestrator.md`.

---

## 13. Locked decisions reference

| Decision | Value |
|---|---|
| Memory substrate | OpenViking (filesystem over `/opt/vault`) |
| Default dev brain (autonomous) | Codex CLI w/ `OPENAI_API_KEY` |
| Fallback dev brain (manual) | Claude Code (installed, not auto-routed) |
| Local SLM tier (day 1) | Qwen 2.5 3B + nomic-embed-text via Ollama |
| Orchestrator | Hermes Agent (headless, localhost:7777) |
| Cost-attribution unit | Per-task (with per-session and per-call drill-down) |
| Budget cap | $30/mo, soft 80% / hard 100%, monthly reset, configurable |
| Cron timezone | America/New_York |
| Telemetry substrate | `agenticos-db` Postgres (repurposed Honcho container) |
| Secret-refresh substrate | 1Password Service Account + hourly systemd timer |
| UI substrate | AgenticOS dashboard (Next.js 16 on App Platform) — brownfield reuse |
