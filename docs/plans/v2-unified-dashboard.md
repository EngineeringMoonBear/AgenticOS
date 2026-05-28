# v2 Unified Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Spec 1 dashboard into a tabbed shell that surfaces Viking-backed memory inspection (browse, drill, trace usage) alongside the existing live-ops view — without any new paid service.

**Architecture:** A hourly Hermes Python cron job ingests `/opt/vault/` markdown into OpenViking (hash-deduped). Viking is reconfigured to use local Ollama for embeddings + VLM. The Next.js dashboard gains tab routing, a shared header (cost / health / quota chips), a polished Live-Ops tab, and a new Memory tab with a three-column browser plus a `react-force-graph-2d` retrieval trajectory visualizer fed by Viking's DebugService.

**Tech Stack:** Next.js 16 (App Router, server components), React 19, TanStack Query 5, nuqs (URL state), Tailwind 4, `react-force-graph-2d` (already a dep), Python 3.12 (`agenticos-hermes` package), psycopg3, OpenViking REST client, node-pg-migrate (SQL migrations), Vitest + Testing Library.

**Locked decisions (do not re-litigate during execution):**
- Memory layer = OpenViking. No mem0, no Honcho.
- Authoring = Obsidian on Mac → `/opt/vault/` via Syncthing.
- Sync = one-way `vault → Viking`.
- Cadence = `0 * * * *` (hourly on the hour).
- Layout = D3 equal-weight tabs with shared header.
- Trajectories = in v1 (not deferred).
- Viking LLM = Ollama OpenAI-compat (`http://ollama:11434/v1`).

---

## File Structure

**Created in this plan:**

| Path | Owner / Purpose |
|---|---|
| `apps/dashboard/migrations/0002_vault_ingest_state.sql` | New table tracking ingested vault files |
| `packages/agenticos-hermes/src/agenticos_hermes/tasks/vault_ingest.py` | Hourly cron job that ingests vault → Viking |
| `packages/agenticos-hermes/tests/test_vault_ingest.py` | Unit tests for the ingester |
| `infra/scripts/configure-viking-llm.sh` | Idempotent script writing Viking's `config.yaml` |
| `apps/dashboard/app/(tabs)/live/page.tsx` | Live-Ops tab page |
| `apps/dashboard/app/(tabs)/memory/page.tsx` | Memory tab page (browser) |
| `apps/dashboard/app/(tabs)/memory/[...uri]/page.tsx` | Memory drill-in page (URL-deeplinkable) |
| `apps/dashboard/components/shell/SharedHeader.tsx` | Cost / health / quota chips |
| `apps/dashboard/components/shell/TabBar.tsx` | Live / Memory tab switcher |
| `apps/dashboard/components/shell/CostBurnChip.tsx` | Header chip — today's spend vs budget |
| `apps/dashboard/components/shell/MaxQuotaChip.tsx` | Header chip — Claude Max quota |
| `apps/dashboard/components/observability/QueueDepthPanel.tsx` | Live-Ops: pending/running counts per kind |
| `apps/dashboard/components/observability/RecentErrorsPanel.tsx` | Live-Ops: last 20 errored task rows |
| `apps/dashboard/components/observability/CostBurndownChart.tsx` | Live-Ops: 24h / 30d cost chart |
| `apps/dashboard/components/memory/CategoryBrowser.tsx` | Memory tab column 1 — namespace tree |
| `apps/dashboard/components/memory/AbstractList.tsx` | Memory tab column 2 — L0 abstracts |
| `apps/dashboard/components/memory/DetailView.tsx` | Memory tab column 3 — L1/L2 detail |
| `apps/dashboard/components/memory/RetrievalTrajectoryGraph.tsx` | Force-graph wrapper for trajectories |
| `apps/dashboard/app/api/memory/tree/route.ts` | GET `?scope=` → namespace tree |
| `apps/dashboard/app/api/memory/abstracts/route.ts` | GET `?uri=` → child L0 abstracts |
| `apps/dashboard/app/api/memory/overview/route.ts` | GET `?uri=` → L1 overview |
| `apps/dashboard/app/api/memory/detail/route.ts` | GET `?uri=` → L2 paginated content |
| `apps/dashboard/app/api/memory/trajectory/route.ts` | GET `?uri=&since=` → force-graph data |
| `apps/dashboard/app/api/ingest/status/route.ts` | GET → last `vault_ingest` run summary |
| `apps/dashboard/lib/hooks/use-cost-burn.ts` | TanStack Query hook for header chip |
| `apps/dashboard/lib/hooks/use-max-quota.ts` | TanStack Query hook for header chip |
| `apps/dashboard/lib/hooks/use-memory-tree.ts` | TanStack Query hook |
| `apps/dashboard/lib/hooks/use-memory-abstracts.ts` | TanStack Query hook |
| `apps/dashboard/lib/hooks/use-memory-detail.ts` | TanStack Query hook |
| `apps/dashboard/lib/hooks/use-trajectory.ts` | TanStack Query hook |

**Modified:**

| Path | Change |
|---|---|
| `apps/dashboard/app/layout.tsx` | Wrap children in tab shell; pull `Header` into `SharedHeader` |
| `apps/dashboard/app/page.tsx` | Server-side tab router redirecting `?tab=` to `/(tabs)/live` or `/(tabs)/memory` |
| `apps/dashboard/components/layout/header.tsx` | Become a thin host for `SharedHeader` (keep existing nav) |
| `apps/dashboard/lib/api/viking.ts` (or equivalent existing Viking client) | Add `getTree`, `getAbstracts`, `getOverview`, `getDetail`, `getTrajectory` helpers |
| `packages/agenticos-hermes/src/agenticos_hermes/tasks/__init__.py` | Register `vault_ingest` |
| `infra/cloud-init/agenticos-droplet.yaml` (or wherever cron lives) | Add `0 * * * * vault-ingest` line |

---

## Phase 0 — Viking LLM lock-down (~3 hrs)

Goal: Viking on the Droplet uses local Ollama for embeddings + VLM with verified round-trip. Establish a known-good baseline before any new ingester writes hit it.

> **STATUS (2026-05-28): substantially already complete in production.** SSH probe found the deployed `ov.conf` (JSON, at `/opt/agenticos/openviking-config/ov.conf`) already has `embedding.dense = {provider: ollama, model: nomic-embed-text, api_base: http://ollama:11434/v1}`. No `vlm:` block — Viking v0.3.19 auto-routes via `OLLAMA_BASE_URL` compose env. RAM constrains VLM to `qwen2.5:3b` (already pulled). **Task 0.3 below is obsolete** — running `configure-viking-llm.sh` as written would brick Viking (YAML over JSON, wrong path, clobbers root API key). Benchmark scripts (Tasks 0.1 / 0.2) are still useful tools. Phase 0 verification is reduced to a single round-trip test, captured at the end of this phase.

### Task 0.1: Benchmark Ollama embedding models

**Files:**
- Create: `infra/scripts/benchmark-ollama-embed.sh`

- [ ] **Step 1: Write the benchmark script**

```bash
#!/usr/bin/env bash
# Compares three Ollama embedding models on latency and dimensionality.
# Run on the Droplet. Picks the one that fits Viking's expected vector size
# and produces sub-500ms responses for ~2 KB inputs.
set -euo pipefail

MODELS=("nomic-embed-text" "bge-large" "mxbai-embed-large")
SAMPLE_FILE="${1:-/opt/vault/skills/sample.md}"

for m in "${MODELS[@]}"; do
  echo "=== ${m} ==="
  ollama pull "${m}" >/dev/null
  start=$(date +%s%3N)
  resp=$(curl -s http://localhost:11434/api/embeddings \
    -d "{\"model\":\"${m}\",\"prompt\":\"$(jq -Rs . < "${SAMPLE_FILE}")\"}")
  end=$(date +%s%3N)
  dim=$(echo "${resp}" | jq '.embedding | length')
  echo "  latency_ms=$((end - start))  dim=${dim}"
done
```

- [ ] **Step 2: Run on Droplet and record results**

Run: `ssh deploy@<droplet-ip> 'bash -s' < infra/scripts/benchmark-ollama-embed.sh`
Expected: three latency/dim rows. Pick the one with lowest latency at dim ≥ 768.

- [ ] **Step 3: Commit results to spec open-questions log**

```bash
# Append to docs/superpowers/specs/2026-05-25-v2-unified-dashboard-design.md
# §9 open question 1 — paste benchmark output as resolution
git add docs/superpowers/specs/2026-05-25-v2-unified-dashboard-design.md \
        infra/scripts/benchmark-ollama-embed.sh
git -c commit.gpgsign=false commit -m "infra: benchmark Ollama embedding models for Viking"
```

### Task 0.2: Benchmark Ollama VLM candidates

**Files:**
- Create: `infra/scripts/benchmark-ollama-vlm.sh`

- [ ] **Step 1: Write the benchmark script**

```bash
#!/usr/bin/env bash
# Compares VLM candidates on L0-abstract generation quality (manual eval)
# and round-trip latency for ~5 KB markdown input.
set -euo pipefail

MODELS=("qwen2.5:7b" "qwen2.5:14b" "llama3.1:8b")
SAMPLE_FILE="${1:-/opt/vault/skills/sample.md}"
PROMPT="Summarize the following document in 80 tokens or fewer:"
INPUT="${PROMPT}\n\n$(cat "${SAMPLE_FILE}")"

for m in "${MODELS[@]}"; do
  echo "=== ${m} ==="
  ollama pull "${m}" >/dev/null
  start=$(date +%s%3N)
  resp=$(curl -s http://localhost:11434/api/generate \
    -d "$(jq -nc --arg m "$m" --arg p "$INPUT" '{model:$m,prompt:$p,stream:false}')")
  end=$(date +%s%3N)
  text=$(echo "${resp}" | jq -r '.response')
  echo "  latency_ms=$((end - start))"
  echo "  output:"
  echo "${text}" | sed 's/^/    /'
done
```

- [ ] **Step 2: Run on Droplet and record results**

Run: `ssh deploy@<droplet-ip> 'bash -s' < infra/scripts/benchmark-ollama-vlm.sh`
Expected: pick best quality at <8s P95 latency. Default to `qwen2.5:7b` if unclear (RAM-safe on 4 GB Droplet).

- [ ] **Step 3: Commit**

```bash
git add infra/scripts/benchmark-ollama-vlm.sh
git -c commit.gpgsign=false commit -m "infra: benchmark Ollama VLM candidates for Viking"
```

### Task 0.3: Write Viking LLM configuration script — **OBSOLETE, DO NOT RUN**

> The script `infra/scripts/configure-viking-llm.sh` was written speculatively against a YAML config shape that doesn't match the deployed JSON `ov.conf`. The deployed config is already correct. Skip steps 1–4 below. They are preserved here only as the historical record of what the plan thought was needed.

**Files:**
- Create: `infra/scripts/configure-viking-llm.sh`

- [ ] **Step 1: Write the script (idempotent — diff-then-write)**

```bash
#!/usr/bin/env bash
# Idempotently writes Viking's LLM config to point at local Ollama.
# Env vars expected: VIKING_CONFIG_PATH (default /opt/viking/config.yaml),
#                    EMBED_MODEL (from Phase 0.1), VLM_MODEL (from Phase 0.2).
set -euo pipefail

VIKING_CONFIG_PATH="${VIKING_CONFIG_PATH:-/opt/viking/config.yaml}"
EMBED_MODEL="${EMBED_MODEL:-nomic-embed-text}"
VLM_MODEL="${VLM_MODEL:-qwen2.5:7b}"

DESIRED=$(cat <<EOF
embedding:
  api_base: http://ollama:11434/v1
  api_key: dummy
  provider: openai
  model: ${EMBED_MODEL}
vlm:
  api_base: http://ollama:11434/v1
  api_key: dummy
  provider: openai
  model: ${VLM_MODEL}
EOF
)

if [[ -f "${VIKING_CONFIG_PATH}" ]] && diff -q <(echo "${DESIRED}") "${VIKING_CONFIG_PATH}" >/dev/null; then
  echo "Viking config already correct — no change."
  exit 0
fi

mkdir -p "$(dirname "${VIKING_CONFIG_PATH}")"
echo "${DESIRED}" > "${VIKING_CONFIG_PATH}"
echo "Wrote Viking config to ${VIKING_CONFIG_PATH}"
echo "Restart Viking: docker compose -f /opt/agenticos/docker-compose.yml restart openviking"
```

- [ ] **Step 2: Run on Droplet and restart Viking**

Run:
```bash
ssh deploy@<droplet-ip> 'EMBED_MODEL=nomic-embed-text VLM_MODEL=qwen2.5:7b \
  bash -s' < infra/scripts/configure-viking-llm.sh
ssh deploy@<droplet-ip> 'docker compose -f /opt/agenticos/docker-compose.yml restart openviking'
```

Expected: "Wrote Viking config to ..." then a clean restart.

- [ ] **Step 3: Verify round-trip with a known doc**

Run:
```bash
ssh deploy@<droplet-ip> bash <<'SH'
echo "# Test doc\n\nHello Viking via Ollama." > /tmp/viking-roundtrip.md
curl -fsS -X POST http://localhost:7333/api/v1/resources \
  -F "file=@/tmp/viking-roundtrip.md" \
  -F "scope=resources/test"
sleep 30   # let L0 generate
curl -fsS "http://localhost:7333/api/v1/abstract?uri=viking://resources/test/viking-roundtrip.md"
SH
```

Expected: a non-empty `{ "abstract": "..." }` JSON body. If empty, check Ollama logs.

- [ ] **Step 4: Commit**

```bash
git add infra/scripts/configure-viking-llm.sh
git -c commit.gpgsign=false commit -m "infra: idempotent Viking LLM config (Ollama-backed)"
```

---

## Phase 1 — Vault ingester (~5 hrs)

Goal: An hourly Hermes cron job that walks `/opt/vault/`, hash-dedups via Postgres, and pushes changed files into Viking.

> **Production-reality notes for Phase 1 (probed 2026-05-28):**
> - **Vault layout:** `/opt/vault/` contains `farming/`, `inbox/`, `.stfolder` (Syncthing internal), and two `HELLO-*.md` test files. No `skills/` or `resources/` subdir. The walker must (a) skip `inbox/` (already handled by `inbox-watcher` daemon — a separate concern) and `.stfolder/`, (b) scope each file by its top-level directory name (`farming/pasture-management/foo.md` → `viking://agent/skills/farming/...` or simply `viking://resources/farming/...` per decision below), (c) accept top-level loose `.md` files into `viking://resources/notes/`.
> - **Cron mechanism:** Hermes uses the `hermes cron create` CLI invoked from inside a Hermes container — `jobs.json` is persisted in the `hermes-data` Docker volume. Bootstrap script `infra/scripts/register-cron-jobs.sh` is the idempotent source-of-truth. Cron scripts are bash wrappers under `packages/agenticos-hermes/wrappers/cron-scripts/` that invoke `python -m agenticos_hermes.tasks.<name>`.
> - **Python Viking access pattern:** existing tasks (`daily_brief.py`) call Viking inline via `httpx` against `OPENVIKING_ENDPOINT` with `Authorization: Bearer ${OPENVIKING_ROOT_API_KEY}` and tenant headers (`X-OpenViking-Account: agenticos`, `X-OpenViking-User: deploy`). No shared `viking_client.py` module exists — the ingester follows the same inline pattern.
> - **Task ledger pattern:** existing tasks INSERT with `status='running'` at start and UPDATE to `'done'` / `'failed'` at end, via `record_task_start` / `record_task_completion` helpers in `tasks/daily_brief.py`. The vault_ingest task must match that pattern (not the plan's earlier direct-`'done'`-insert shortcut).
> - **Scope decision (one-way ingestion):** all vault files land under `viking://resources/<top-level-dir>/...` (e.g. `viking://resources/farming/pasture-management/rotation.md`). Skill content under `viking://agent/skills/` is created by the agent itself via `viking.add_resource`, not pushed from the vault. This keeps the vault as "what the human authored" and Viking's agent-skills scope as "what the agent has learned to do."

### Task 1.1: Create `vault_ingest_state` migration

**Files:**
- Create: `apps/dashboard/migrations/0002_vault_ingest_state.sql`

- [ ] **Step 1: Write the migration**

```sql
-- vault_ingest_state — one row per vault file currently tracked in Viking.
-- Updated by packages/agenticos-hermes/.../tasks/vault_ingest.py on each run.
-- Keyed by path so the ingester can detect deletions in O(1) per file.

CREATE TABLE IF NOT EXISTS vault_ingest_state (
  path           TEXT PRIMARY KEY,
  sha256         CHAR(64) NOT NULL,
  scope          TEXT NOT NULL,
  viking_uri     TEXT NOT NULL,
  last_ingested  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL CHECK (status IN ('ok','errored')),
  error          TEXT
);

CREATE INDEX IF NOT EXISTS idx_vault_ingest_state_scope
  ON vault_ingest_state (scope);
```

- [ ] **Step 2: Run migration locally**

Run: `cd apps/dashboard && pnpm migrate:up`
Expected: `Migrations complete.` Verify with `psql $AGENTICOS_DB_URL -c '\d vault_ingest_state'`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/migrations/0002_vault_ingest_state.sql
git -c commit.gpgsign=false commit -m "db: vault_ingest_state migration"
```

### Task 1.2: Write the ingester walker (no Viking calls yet)

**Files:**
- Create: `packages/agenticos-hermes/src/agenticos_hermes/tasks/vault_ingest.py`
- Create: `packages/agenticos-hermes/tests/test_vault_ingest.py`

- [ ] **Step 1: Write failing test for `walk_vault`**

```python
# packages/agenticos-hermes/tests/test_vault_ingest.py
from pathlib import Path
from agenticos_hermes.tasks.vault_ingest import walk_vault, file_sha256

def test_walk_vault_yields_skills_and_resources(tmp_path: Path):
    skills = tmp_path / "skills"
    resources = tmp_path / "resources" / "farm"
    skills.mkdir(parents=True)
    resources.mkdir(parents=True)
    (skills / "a.md").write_text("a")
    (resources / "b.md").write_text("b")
    (tmp_path / "ignore.txt").write_text("ignore")

    items = list(walk_vault(tmp_path))
    paths = {(p.path.name, p.scope) for p in items}
    assert paths == {("a.md", "agent/skills"), ("b.md", "resources/farm")}

def test_file_sha256_stable(tmp_path: Path):
    p = tmp_path / "x.md"
    p.write_text("hello")
    h1 = file_sha256(p)
    h2 = file_sha256(p)
    assert h1 == h2 and len(h1) == 64
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agenticos-hermes && pytest tests/test_vault_ingest.py -v`
Expected: `ModuleNotFoundError: No module named 'agenticos_hermes.tasks.vault_ingest'`.

- [ ] **Step 3: Write the walker**

```python
# packages/agenticos-hermes/src/agenticos_hermes/tasks/vault_ingest.py
"""Vault → Viking hourly ingester.

Walks /opt/vault/{skills,resources}, hash-dedups via vault_ingest_state,
calls viking.add_resource() on changes, viking.rm() on deletions.

Idempotent. Single-file errors do not abort the run.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator
import hashlib

VAULT_ROOT = Path("/opt/vault")
SKILLS_SCOPE = "agent/skills"
RESOURCES_SCOPE_PREFIX = "resources/"  # plus project subdir


@dataclass(frozen=True)
class VaultItem:
    path: Path
    scope: str


def walk_vault(root: Path = VAULT_ROOT) -> Iterator[VaultItem]:
    """Yield every .md file under root/skills and root/resources/* with its Viking scope."""
    skills = root / "skills"
    if skills.is_dir():
        for p in skills.rglob("*.md"):
            yield VaultItem(path=p, scope=SKILLS_SCOPE)
    resources = root / "resources"
    if resources.is_dir():
        for project_dir in resources.iterdir():
            if not project_dir.is_dir():
                continue
            for p in project_dir.rglob("*.md"):
                yield VaultItem(path=p, scope=f"{RESOURCES_SCOPE_PREFIX}{project_dir.name}")


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agenticos-hermes && pytest tests/test_vault_ingest.py -v`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agenticos-hermes/src/agenticos_hermes/tasks/vault_ingest.py \
        packages/agenticos-hermes/tests/test_vault_ingest.py
git -c commit.gpgsign=false commit -m "feat(hermes): vault walker + sha256 dedup primitive"
```

### Task 1.3: Add `vault_ingest_state` DAO

**Files:**
- Modify: `packages/agenticos-hermes/src/agenticos_hermes/tasks/vault_ingest.py`
- Modify: `packages/agenticos-hermes/tests/test_vault_ingest.py`

- [ ] **Step 1: Write failing tests for upsert / delete / list-stale**

```python
# Append to tests/test_vault_ingest.py
import pytest
from agenticos_hermes.tasks.vault_ingest import (
    upsert_ingest_row, delete_ingest_row, list_tracked_paths, IngestRow,
)
from agenticos_hermes.db import connect

@pytest.fixture
def clean_table():
    with connect() as conn:
        conn.execute("DELETE FROM vault_ingest_state")
    yield
    with connect() as conn:
        conn.execute("DELETE FROM vault_ingest_state")

def test_upsert_inserts_then_updates(clean_table):
    upsert_ingest_row(IngestRow(path="/x.md", sha256="a"*64, scope="agent/skills",
                                viking_uri="viking://agent/skills/x.md", status="ok", error=None))
    upsert_ingest_row(IngestRow(path="/x.md", sha256="b"*64, scope="agent/skills",
                                viking_uri="viking://agent/skills/x.md", status="ok", error=None))
    assert list_tracked_paths() == {"/x.md"}

def test_delete_removes(clean_table):
    upsert_ingest_row(IngestRow(path="/y.md", sha256="c"*64, scope="agent/skills",
                                viking_uri="viking://agent/skills/y.md", status="ok", error=None))
    delete_ingest_row("/y.md")
    assert list_tracked_paths() == set()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agenticos-hermes && pytest tests/test_vault_ingest.py -v`
Expected: `ImportError` on `upsert_ingest_row` etc.

- [ ] **Step 3: Implement the DAO functions**

Append to `vault_ingest.py`:

```python
from dataclasses import dataclass
from typing import Optional
from agenticos_hermes.db import connect


@dataclass(frozen=True)
class IngestRow:
    path: str
    sha256: str
    scope: str
    viking_uri: str
    status: str  # 'ok' | 'errored'
    error: Optional[str]


def upsert_ingest_row(row: IngestRow) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO vault_ingest_state (path, sha256, scope, viking_uri, status, error, last_ingested)
            VALUES (%s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (path) DO UPDATE SET
              sha256        = EXCLUDED.sha256,
              scope         = EXCLUDED.scope,
              viking_uri    = EXCLUDED.viking_uri,
              status        = EXCLUDED.status,
              error         = EXCLUDED.error,
              last_ingested = now()
            """,
            (row.path, row.sha256, row.scope, row.viking_uri, row.status, row.error),
        )


def delete_ingest_row(path: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM vault_ingest_state WHERE path = %s", (path,))


def list_tracked_paths() -> set[str]:
    with connect() as conn:
        rows = conn.execute("SELECT path FROM vault_ingest_state").fetchall()
    return {r[0] for r in rows}


def get_tracked_sha(path: str) -> Optional[str]:
    with connect() as conn:
        row = conn.execute(
            "SELECT sha256 FROM vault_ingest_state WHERE path = %s", (path,)
        ).fetchone()
    return row[0] if row else None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agenticos-hermes && pytest tests/test_vault_ingest.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agenticos-hermes/
git -c commit.gpgsign=false commit -m "feat(hermes): vault_ingest_state DAO"
```

### Task 1.4: Wire Viking client into ingester (with retry)

**Files:**
- Modify: `packages/agenticos-hermes/src/agenticos_hermes/tasks/vault_ingest.py`
- Modify: `packages/agenticos-hermes/tests/test_vault_ingest.py`

- [ ] **Step 1: Write failing test using a fake Viking client**

```python
# Append to tests/test_vault_ingest.py
from pathlib import Path
from agenticos_hermes.tasks.vault_ingest import run_ingest, FakeViking

def test_run_ingest_adds_new_file(tmp_path, clean_table):
    (tmp_path / "skills").mkdir()
    f = tmp_path / "skills" / "a.md"
    f.write_text("hello")
    fake = FakeViking()
    summary = run_ingest(vault_root=tmp_path, viking=fake)
    assert summary == {"added": 1, "updated": 0, "removed": 0, "skipped": 0, "errored": 0}
    assert fake.added == [(str(f), "agent/skills")]

def test_run_ingest_skips_unchanged(tmp_path, clean_table):
    (tmp_path / "skills").mkdir()
    f = tmp_path / "skills" / "a.md"
    f.write_text("hello")
    fake = FakeViking()
    run_ingest(vault_root=tmp_path, viking=fake)
    fake.added.clear()
    summary = run_ingest(vault_root=tmp_path, viking=fake)
    assert summary["skipped"] == 1 and summary["added"] == 0
    assert fake.added == []

def test_run_ingest_detects_deletion(tmp_path, clean_table):
    (tmp_path / "skills").mkdir()
    f = tmp_path / "skills" / "a.md"
    f.write_text("hello")
    fake = FakeViking()
    run_ingest(vault_root=tmp_path, viking=fake)
    f.unlink()
    summary = run_ingest(vault_root=tmp_path, viking=fake)
    assert summary["removed"] == 1
    assert fake.removed == [f"viking://agent/skills/{f.name}"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agenticos-hermes && pytest tests/test_vault_ingest.py -v`
Expected: `ImportError: cannot import name 'run_ingest'`.

- [ ] **Step 3: Implement `run_ingest` + `FakeViking` + real client wrapper**

Append to `vault_ingest.py`:

```python
import os
import logging
from typing import Protocol

log = logging.getLogger(__name__)


class VikingClient(Protocol):
    def add_resource(self, file_path: str, scope: str) -> str: ...  # returns viking_uri
    def rm(self, uri: str) -> None: ...


class FakeViking:
    """Test double — records calls instead of hitting Viking REST."""
    def __init__(self) -> None:
        self.added: list[tuple[str, str]] = []
        self.removed: list[str] = []

    def add_resource(self, file_path: str, scope: str) -> str:
        self.added.append((file_path, scope))
        return f"viking://{scope}/{Path(file_path).name}"

    def rm(self, uri: str) -> None:
        self.removed.append(uri)


def run_ingest(
    vault_root: Path = VAULT_ROOT,
    viking: VikingClient | None = None,
) -> dict[str, int]:
    """Walk vault, sync to Viking, return summary counts.

    Single-file errors are caught and counted; the run continues.
    """
    if viking is None:
        from agenticos_hermes.viking_client import OpenVikingClient  # real client
        viking = OpenVikingClient(base_url=os.environ["VIKING_BASE_URL"])

    summary = {"added": 0, "updated": 0, "removed": 0, "skipped": 0, "errored": 0}
    seen_paths: set[str] = set()

    for item in walk_vault(vault_root):
        path_str = str(item.path)
        seen_paths.add(path_str)
        try:
            sha = file_sha256(item.path)
            prior = get_tracked_sha(path_str)
            if prior == sha:
                summary["skipped"] += 1
                continue
            viking_uri = viking.add_resource(path_str, item.scope)
            upsert_ingest_row(IngestRow(
                path=path_str, sha256=sha, scope=item.scope,
                viking_uri=viking_uri, status="ok", error=None,
            ))
            if prior is None:
                summary["added"] += 1
            else:
                summary["updated"] += 1
        except Exception as e:
            log.exception("Ingest failed for %s", path_str)
            summary["errored"] += 1
            upsert_ingest_row(IngestRow(
                path=path_str, sha256="0"*64, scope=item.scope,
                viking_uri="", status="errored", error=str(e),
            ))

    # Detect deletions
    tracked = list_tracked_paths()
    for stale_path in tracked - seen_paths:
        try:
            with connect() as conn:
                row = conn.execute(
                    "SELECT viking_uri FROM vault_ingest_state WHERE path = %s",
                    (stale_path,),
                ).fetchone()
            if row and row[0]:
                viking.rm(row[0])
            delete_ingest_row(stale_path)
            summary["removed"] += 1
        except Exception:
            log.exception("Failed to remove stale path %s", stale_path)
            summary["errored"] += 1

    return summary
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agenticos-hermes && pytest tests/test_vault_ingest.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agenticos-hermes/
git -c commit.gpgsign=false commit -m "feat(hermes): vault_ingest end-to-end with FakeViking tests"
```

### Task 1.5: Emit a task ledger row per run

**Files:**
- Modify: `packages/agenticos-hermes/src/agenticos_hermes/tasks/vault_ingest.py`

- [ ] **Step 1: Add `record_run_summary` helper and call from `run_ingest`**

Append to `vault_ingest.py`:

```python
import json
import uuid
from datetime import datetime, timezone


def record_run_summary(summary: dict[str, int]) -> str:
    """Insert one task ledger row summarizing this ingest run. Returns task_id."""
    task_id = f"vault-ingest-{uuid.uuid4().hex[:12]}"
    has_error = summary["errored"] > 0
    status = "failed" if has_error and summary["added"] + summary["updated"] == 0 else "done"
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO tasks (id, kind, trigger, status, started_at, ended_at, cost_cents, error, metadata)
            VALUES (%s, 'vault-ingest', 'cron', %s, now(), now(), 0, %s, %s::jsonb)
            """,
            (task_id, status,
             f"{summary['errored']} files errored" if has_error else None,
             json.dumps(summary)),
        )
    return task_id
```

Then in `run_ingest`, before returning, add:

```python
    record_run_summary(summary)
    return summary
```

- [ ] **Step 2: Add a test verifying the ledger row**

```python
# Append to tests/test_vault_ingest.py
def test_run_ingest_writes_ledger_row(tmp_path, clean_table):
    (tmp_path / "skills").mkdir()
    (tmp_path / "skills" / "a.md").write_text("hi")
    run_ingest(vault_root=tmp_path, viking=FakeViking())
    with connect() as conn:
        rows = conn.execute(
            "SELECT kind, status, metadata FROM tasks WHERE kind = 'vault-ingest' ORDER BY started_at DESC LIMIT 1"
        ).fetchall()
    assert rows and rows[0][0] == "vault-ingest" and rows[0][1] == "done"
    assert rows[0][2]["added"] == 1
```

- [ ] **Step 3: Run tests**

Run: `cd packages/agenticos-hermes && pytest tests/test_vault_ingest.py -v`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/agenticos-hermes/
git -c commit.gpgsign=false commit -m "feat(hermes): emit tasks ledger row from vault_ingest"
```

### Task 1.6: Register the cron entry (wrapper script + register-cron-jobs.sh)

**Files:**
- Create: `packages/agenticos-hermes/wrappers/cron-scripts/vault-ingest.sh`
- Modify: `infra/scripts/register-cron-jobs.sh` (add a `register vault-ingest` line)

- [ ] **Step 1: Create the cron wrapper (one-liner, matches existing pattern)**

```bash
# packages/agenticos-hermes/wrappers/cron-scripts/vault-ingest.sh
#!/bin/bash
# Hermes cron wrapper for the vault-ingest task.
# Walks /opt/vault and pushes changed files into OpenViking. See
# agenticos_hermes.tasks.vault_ingest for the implementation.
set -euo pipefail
exec /opt/hermes/.venv/bin/python -m agenticos_hermes.tasks.vault_ingest
```

`chmod +x` it.

- [ ] **Step 2: Add the registration line to `infra/scripts/register-cron-jobs.sh`**

After the existing `register cost-report ...` line, insert:

```bash
register vault-ingest "0 * * * *" vault-ingest.sh
```

This is idempotent (the script's `register()` helper skips if `hermes cron list` already shows the name).

- [ ] **Step 3: Apply on the Droplet**

```bash
ssh deploy@159.223.171.231 'docker exec hermes-agent /opt/agenticos/repo/infra/scripts/register-cron-jobs.sh'
```

Verify: `ssh deploy@159.223.171.231 'docker exec hermes-agent /opt/hermes/.venv/bin/hermes cron list'` shows a `vault-ingest` row.

- [ ] **Step 4: Commit**

```bash
git add packages/agenticos-hermes/wrappers/cron-scripts/vault-ingest.sh \
        infra/scripts/register-cron-jobs.sh
git -c commit.gpgsign=false commit -m "infra: register hourly vault-ingest cron"
```

### Task 1.7: End-to-end smoke test on Droplet

- [ ] **Step 1: Edit a vault file via Obsidian (or manually) and wait**

Create `/opt/vault/skills/v2-smoke-test.md` with a unique marker string. Wait for the next top-of-hour cron tick (or trigger manually: `hermes cron run vault-ingest`).

- [ ] **Step 2: Verify Viking has the new resource**

Run on Droplet: `curl -fsS "http://localhost:7333/api/v1/search/find?query=v2-smoke-test"`
Expected: a result row whose `uri` contains `v2-smoke-test.md`.

- [ ] **Step 3: Verify ledger row**

Run: `psql $AGENTICOS_DB_URL -c "SELECT id, status, metadata FROM tasks WHERE kind='vault-ingest' ORDER BY started_at DESC LIMIT 1;"`
Expected: latest row has `status='done'` and `metadata` includes `"added": 1` (or `"updated"`).

- [ ] **Step 4: Document the smoke-test outcome in the spec acceptance log**

Update `docs/superpowers/specs/2026-05-25-v2-unified-dashboard-design.md` §10 acceptance criterion #1 with date + result.

```bash
git add docs/superpowers/specs/2026-05-25-v2-unified-dashboard-design.md
git -c commit.gpgsign=false commit -m "docs: record Phase 1 acceptance smoke test"
```

---

## Phase 2 — Dashboard shell (~4 hrs)

Goal: Tab routing, shared header. Tabs render placeholders. All three header chips poll live data.

### Task 2.1: Add tab router

**Files:**
- Create: `apps/dashboard/app/(tabs)/live/page.tsx`
- Create: `apps/dashboard/app/(tabs)/memory/page.tsx`
- Modify: `apps/dashboard/app/page.tsx`

- [ ] **Step 1: Move existing root page into `/(tabs)/live`**

Read current `apps/dashboard/app/page.tsx`, save its contents, then create the new file:

```tsx
// apps/dashboard/app/(tabs)/live/page.tsx
// Phase 2: placeholder; Phase 3 fills it in with the existing observability components.
export default function LiveOpsPage() {
  return (
    <section className="p-6">
      <h1 className="text-2xl font-semibold">Live Ops</h1>
      <p className="text-sm opacity-70">Filled in during Phase 3.</p>
    </section>
  );
}
```

- [ ] **Step 2: Add memory placeholder**

```tsx
// apps/dashboard/app/(tabs)/memory/page.tsx
export default function MemoryPage() {
  return (
    <section className="p-6">
      <h1 className="text-2xl font-semibold">Memory</h1>
      <p className="text-sm opacity-70">Filled in during Phase 4.</p>
    </section>
  );
}
```

- [ ] **Step 3: Rewrite the root page to redirect**

```tsx
// apps/dashboard/app/page.tsx
import { redirect } from "next/navigation";

export default function RootPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab = searchParams.tab === "memory" ? "memory" : "live";
  redirect(`/${tab}`);
}
```

Wait — the App Router treats `(tabs)` as a route group (no URL segment). So `app/(tabs)/live/page.tsx` resolves to `/live`. That matches the redirect.

- [ ] **Step 4: Verify locally**

Run: `cd apps/dashboard && pnpm dev`
Visit `http://localhost:3000/` → redirected to `/live`. Visit `/?tab=memory` → redirected to `/memory`. Visit `/memory` directly → renders Memory placeholder.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/
git -c commit.gpgsign=false commit -m "feat(dashboard): tab routing scaffold"
```

### Task 2.2: Build `TabBar`

**Files:**
- Create: `apps/dashboard/components/shell/TabBar.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/dashboard/components/shell/TabBar.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/live", label: "Live Ops" },
  { href: "/memory", label: "Memory" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b" role="tablist" aria-label="Dashboard tabs">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={active}
            className={cn(
              "px-4 py-2 text-sm border-b-2 -mb-px transition-colors",
              active
                ? "border-foreground text-foreground"
                : "border-transparent opacity-60 hover:opacity-100"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Add a smoke test**

```tsx
// apps/dashboard/components/shell/TabBar.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TabBar } from "./TabBar";

vi.mock("next/navigation", () => ({ usePathname: () => "/live" }));

describe("TabBar", () => {
  it("marks the active tab as selected", () => {
    render(<TabBar />);
    expect(screen.getByRole("tab", { name: "Live Ops" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Memory" })).toHaveAttribute("aria-selected", "false");
  });
});
```

- [ ] **Step 3: Run test**

Run: `cd apps/dashboard && pnpm test components/shell/TabBar.test.tsx`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/components/shell/
git -c commit.gpgsign=false commit -m "feat(dashboard): TabBar with active-state styling"
```

### Task 2.3: Build `CostBurnChip`

**Files:**
- Create: `apps/dashboard/lib/hooks/use-cost-burn.ts`
- Create: `apps/dashboard/components/shell/CostBurnChip.tsx`

- [ ] **Step 1: Add the hook**

```ts
// apps/dashboard/lib/hooks/use-cost-burn.ts
"use client";
import { useQuery } from "@tanstack/react-query";

export interface CostBurn {
  today_cents: number;
  budget_cents: number;
  pct_used: number;
}

export function useCostBurn() {
  return useQuery<CostBurn>({
    queryKey: ["cost-burn"],
    queryFn: async () => {
      const r = await fetch("/api/cost/today");
      if (!r.ok) throw new Error(`cost burn HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
  });
}
```

- [ ] **Step 2: Verify `/api/cost/today` exists**

Run: `ls apps/dashboard/app/api/cost/`
Expected: contains a route handler. If it returns a different shape, adapt the hook to match. If missing, file a follow-up — but do not block Phase 2 since Spec 1 shipped this.

- [ ] **Step 3: Build the chip**

```tsx
// apps/dashboard/components/shell/CostBurnChip.tsx
"use client";
import { useCostBurn } from "@/lib/hooks/use-cost-burn";

function tier(pct: number): string {
  if (pct >= 100) return "bg-red-500/20 text-red-100 border-red-500/40";
  if (pct >= 80)  return "bg-amber-500/20 text-amber-100 border-amber-500/40";
  return "bg-emerald-500/20 text-emerald-100 border-emerald-500/40";
}

export function CostBurnChip() {
  const { data, isError } = useCostBurn();
  if (isError) return <Chip>—</Chip>;
  if (!data) return <Chip>…</Chip>;
  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
  return (
    <Chip className={tier(data.pct_used)}>
      {dollars(data.today_cents)} / {dollars(data.budget_cents)}
    </Chip>
  );
}

function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs border ${className}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/components/shell/CostBurnChip.tsx \
        apps/dashboard/lib/hooks/use-cost-burn.ts
git -c commit.gpgsign=false commit -m "feat(dashboard): cost burn header chip"
```

### Task 2.4: Build `MaxQuotaChip`

**Files:**
- Create: `apps/dashboard/lib/hooks/use-max-quota.ts`
- Create: `apps/dashboard/components/shell/MaxQuotaChip.tsx`

- [ ] **Step 1: Hook**

```ts
// apps/dashboard/lib/hooks/use-max-quota.ts
"use client";
import { useQuery } from "@tanstack/react-query";

export interface MaxQuota {
  remaining_pct: number;
  resets_at: string;  // ISO
}

export function useMaxQuota() {
  return useQuery<MaxQuota>({
    queryKey: ["max-quota"],
    queryFn: async () => {
      const r = await fetch("/api/limits/max");
      if (!r.ok) throw new Error(`max quota HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
  });
}
```

- [ ] **Step 2: Chip**

```tsx
// apps/dashboard/components/shell/MaxQuotaChip.tsx
"use client";
import { useMaxQuota } from "@/lib/hooks/use-max-quota";

export function MaxQuotaChip() {
  const { data, isError } = useMaxQuota();
  if (isError) return <span className="px-3 py-1 text-xs border rounded-full">Max: —</span>;
  if (!data) return <span className="px-3 py-1 text-xs border rounded-full">Max: …</span>;
  const tone =
    data.remaining_pct < 10 ? "border-red-500/40 text-red-200" :
    data.remaining_pct < 25 ? "border-amber-500/40 text-amber-200" :
                              "border-emerald-500/40 text-emerald-200";
  return (
    <span className={`px-3 py-1 text-xs border rounded-full ${tone}`}>
      Max: {data.remaining_pct.toFixed(0)}%
    </span>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/components/shell/MaxQuotaChip.tsx \
        apps/dashboard/lib/hooks/use-max-quota.ts
git -c commit.gpgsign=false commit -m "feat(dashboard): Max quota header chip"
```

### Task 2.5: Build `SharedHeader` and wire layout

**Files:**
- Create: `apps/dashboard/components/shell/SharedHeader.tsx`
- Modify: `apps/dashboard/app/layout.tsx`

- [ ] **Step 1: Implement `SharedHeader`**

```tsx
// apps/dashboard/components/shell/SharedHeader.tsx
import { CostBurnChip } from "./CostBurnChip";
import { MaxQuotaChip } from "./MaxQuotaChip";
import { AgentStatusChip } from "@/components/observability/AgentStatusChip";
import { TabBar } from "./TabBar";

export function SharedHeader() {
  return (
    <header className="border-b" style={{ backgroundColor: "var(--bg)" }}>
      <div className="flex items-center justify-between px-6 py-3">
        <div className="text-sm font-semibold tracking-wide">AgenticOS</div>
        <div className="flex items-center gap-2">
          <CostBurnChip />
          <AgentStatusChip />
          <MaxQuotaChip />
        </div>
      </div>
      <TabBar />
    </header>
  );
}
```

- [ ] **Step 2: Swap `Header` for `SharedHeader` in layout**

In `apps/dashboard/app/layout.tsx`, replace `import { Header } from "@/components/layout/header";` with `import { SharedHeader } from "@/components/shell/SharedHeader";` and `<Header />` with `<SharedHeader />`. Keep existing `Header` file untouched until any unique nav inside it is migrated; if it has unique content, port it into `SharedHeader`.

- [ ] **Step 3: Visual verification**

Run: `pnpm dev`. Visit `/live` and `/memory`. Both should show identical header with three chips and a tab bar; the active tab is underlined.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/
git -c commit.gpgsign=false commit -m "feat(dashboard): SharedHeader with cost/agent/quota chips"
```

---

## Phase 3 — Live-Ops tab polish (~5 hrs)

Goal: Promote existing live components into the Live-Ops tab; add `QueueDepthPanel`, `RecentErrorsPanel`, `CostBurndownChart`.

### Task 3.1: Move existing live components into `/live`

**Files:**
- Modify: `apps/dashboard/app/(tabs)/live/page.tsx`

- [ ] **Step 1: Compose the page**

```tsx
// apps/dashboard/app/(tabs)/live/page.tsx
import { LiveRunsStrip } from "@/components/observability/live-runs-strip";
import { RateLimitsPanel } from "@/components/observability/RateLimitsPanel";
import { RunFeed } from "@/components/observability/run-feed";
import { QueueDepthPanel } from "@/components/observability/QueueDepthPanel";
import { RecentErrorsPanel } from "@/components/observability/RecentErrorsPanel";
import { CostBurndownChart } from "@/components/observability/CostBurndownChart";

export default function LiveOpsPage() {
  return (
    <div className="grid grid-cols-12 gap-4 p-4">
      <section className="col-span-12">
        <LiveRunsStrip />
      </section>
      <section className="col-span-12 lg:col-span-8">
        <CostBurndownChart />
      </section>
      <section className="col-span-12 lg:col-span-4">
        <RateLimitsPanel />
      </section>
      <section className="col-span-12 lg:col-span-6">
        <QueueDepthPanel />
      </section>
      <section className="col-span-12 lg:col-span-6">
        <RecentErrorsPanel />
      </section>
      <section className="col-span-12">
        <RunFeed />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Stub the new panels so the page compiles**

Create each new component with a placeholder, e.g.:

```tsx
// apps/dashboard/components/observability/QueueDepthPanel.tsx
export function QueueDepthPanel() {
  return <div className="border rounded-lg p-4 text-sm opacity-70">Queue depth — coming in Phase 3.</div>;
}
```

Do the same for `RecentErrorsPanel.tsx` and `CostBurndownChart.tsx`.

- [ ] **Step 3: Verify page renders**

Run: `pnpm dev` → visit `/live` → page mounts without error.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/
git -c commit.gpgsign=false commit -m "feat(dashboard): live-ops tab layout with placeholders"
```

### Task 3.2: Implement `QueueDepthPanel`

**Files:**
- Create: `apps/dashboard/app/api/tasks/queue-depth/route.ts`
- Modify: `apps/dashboard/components/observability/QueueDepthPanel.tsx`

- [ ] **Step 1: API route**

```ts
// apps/dashboard/app/api/tasks/queue-depth/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";  // existing helper, verify the import path

export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query<{ kind: string; status: string; n: string }>(
    `SELECT kind, status, COUNT(*)::text AS n
     FROM tasks
     WHERE status IN ('queued', 'running')
     GROUP BY kind, status
     ORDER BY kind, status`,
  );
  return NextResponse.json({
    rows: rows.map((r) => ({ kind: r.kind, status: r.status, count: Number(r.n) })),
  });
}
```

If `@/lib/db` does not export `getPool`, look at how existing routes (e.g. `app/api/tasks/route.ts`) obtain a connection and copy that pattern verbatim.

- [ ] **Step 2: Panel**

```tsx
// apps/dashboard/components/observability/QueueDepthPanel.tsx
"use client";
import { useQuery } from "@tanstack/react-query";

interface Row { kind: string; status: string; count: number; }

export function QueueDepthPanel() {
  const { data } = useQuery<{ rows: Row[] }>({
    queryKey: ["queue-depth"],
    queryFn: async () => (await fetch("/api/tasks/queue-depth")).json(),
    refetchInterval: 15_000,
  });
  return (
    <div className="border rounded-lg p-4">
      <h3 className="text-sm font-semibold mb-2">Queue depth</h3>
      {!data || data.rows.length === 0 ? (
        <p className="text-xs opacity-70">No queued or running tasks.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {data.rows.map((r) => (
            <li key={`${r.kind}:${r.status}`} className="flex justify-between">
              <span>{r.kind} · <span className="opacity-60">{r.status}</span></span>
              <span className="tabular-nums">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/
git -c commit.gpgsign=false commit -m "feat(dashboard): QueueDepthPanel + /api/tasks/queue-depth"
```

### Task 3.3: Implement `RecentErrorsPanel`

**Files:**
- Create: `apps/dashboard/app/api/tasks/recent-errors/route.ts`
- Modify: `apps/dashboard/components/observability/RecentErrorsPanel.tsx`

- [ ] **Step 1: API route**

```ts
// apps/dashboard/app/api/tasks/recent-errors/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string; kind: string; error: string | null; started_at: string;
  }>(
    `SELECT id, kind, error, started_at
     FROM tasks
     WHERE status = 'failed'
     ORDER BY started_at DESC
     LIMIT 20`,
  );
  return NextResponse.json({ rows });
}
```

- [ ] **Step 2: Panel**

```tsx
// apps/dashboard/components/observability/RecentErrorsPanel.tsx
"use client";
import { useQuery } from "@tanstack/react-query";

interface Row { id: string; kind: string; error: string | null; started_at: string; }

export function RecentErrorsPanel() {
  const { data } = useQuery<{ rows: Row[] }>({
    queryKey: ["recent-errors"],
    queryFn: async () => (await fetch("/api/tasks/recent-errors")).json(),
    refetchInterval: 30_000,
  });
  return (
    <div className="border rounded-lg p-4">
      <h3 className="text-sm font-semibold mb-2">Recent errors</h3>
      {!data || data.rows.length === 0 ? (
        <p className="text-xs opacity-70">No errored tasks in recent history.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {data.rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-0.5 border-b pb-1">
              <div className="flex justify-between">
                <span className="font-mono text-xs opacity-70">{r.id}</span>
                <span className="text-xs opacity-60">{new Date(r.started_at).toLocaleString()}</span>
              </div>
              <div className="text-xs">
                <span className="opacity-70">{r.kind}: </span>
                <span className="opacity-90 truncate">{r.error ?? "(no message)"}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/
git -c commit.gpgsign=false commit -m "feat(dashboard): RecentErrorsPanel"
```

### Task 3.4: Implement `CostBurndownChart`

**Files:**
- Create: `apps/dashboard/app/api/cost/burndown/route.ts`
- Modify: `apps/dashboard/components/observability/CostBurndownChart.tsx`

- [ ] **Step 1: API route — supports 24h / 30d**

```ts
// apps/dashboard/app/api/cost/burndown/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const range = url.searchParams.get("range") === "30d" ? "30d" : "24h";
  const bucket = range === "30d" ? "day" : "hour";
  const sinceClause = range === "30d" ? "now() - interval '30 days'" : "now() - interval '24 hours'";
  const pool = getPool();
  const { rows } = await pool.query<{ bucket: string; cents: string }>(
    `SELECT date_trunc('${bucket}', occurred_at)::text AS bucket,
            SUM(cost_cents)::text AS cents
     FROM calls
     WHERE occurred_at >= ${sinceClause}
     GROUP BY 1
     ORDER BY 1`,
  );
  return NextResponse.json({
    range,
    bucket,
    points: rows.map((r) => ({ at: r.bucket, cents: Number(r.cents) })),
  });
}
```

- [ ] **Step 2: Chart component (SVG, no new dep — reuse `SparklineSvg` pattern from `components/observability/SparklineSvg.tsx`)**

```tsx
// apps/dashboard/components/observability/CostBurndownChart.tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

type Range = "24h" | "30d";
interface Point { at: string; cents: number; }

export function CostBurndownChart() {
  const [range, setRange] = useState<Range>("24h");
  const { data } = useQuery<{ points: Point[] }>({
    queryKey: ["burndown", range],
    queryFn: async () => (await fetch(`/api/cost/burndown?range=${range}`)).json(),
    refetchInterval: 60_000,
  });
  const pts = data?.points ?? [];
  const max = Math.max(1, ...pts.map((p) => p.cents));
  const W = 600, H = 160, P = 24;
  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Cost burndown</h3>
        <div className="flex gap-1 text-xs">
          {(["24h", "30d"] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded ${r === range ? "bg-white/10" : "opacity-60"}`}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40">
        {pts.map((p, i) => {
          const x = P + (i * (W - 2 * P)) / Math.max(1, pts.length - 1);
          const h = ((H - 2 * P) * p.cents) / max;
          return <rect key={p.at} x={x - 4} y={H - P - h} width={8} height={h} className="fill-current opacity-70" />;
        })}
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/
git -c commit.gpgsign=false commit -m "feat(dashboard): cost burndown chart with 24h/30d toggle"
```

### Task 3.5: Live-Ops smoke check

- [ ] **Step 1: Run dev server, click through every panel, confirm no console errors**

Run: `cd apps/dashboard && pnpm dev` → `/live` → DevTools console clean. Mock the DB if needed by running existing dashboard fixture seeds.

- [ ] **Step 2: Run vitest**

Run: `cd apps/dashboard && pnpm test`
Expected: all green, no new failures vs baseline.

---

## Phase 3.5 — v2 design-system migration (~18 hrs)

> **Inserted 2026-05-29 after the v2 dashboard UI mockup was approved.** The mockup at `docs/design/v2-ui-mockup.html` (PR #101) is the canonical design reference. This phase ports the mockup's patterns — tokens, components, 4-tab structure, glass-pane card grammar, KPI vista with EKG, lantern-mushroom logo — into the actual `apps/dashboard/` codebase. After Phase 3.5 lands, Phase 4 (Memory tab) and beyond build against the new system.

**The mockup IS the spec.** Each sub-phase below references specific sections of the mockup file rather than restating design decisions inline. Implementer subagents should open `docs/design/v2-ui-mockup.html` in a browser before starting to see what they're building.

**Locked decisions from the mockup (do not re-litigate):**
- Body background SOLID `#060f0b` (no gradient — fixes prior WCAG AA regression)
- Forest+autumn palette with gold (`#c9a227`) + pine (`#6ba480`) accents
- Dusk indigo (`#0e1530`) for KPI vista only; cards use surface (`#182721`)
- Glass-pane cards: multi-layer shadow + state-colored top spine (gold/pine/amber/russet)
- Lantern-mushroom logo (in mockup `<svg class="logo">` at the brand link)
- Tab structure: Runs · Cost · Health · Memory (grouped by data source, not by abstract category)
- KPI vista persistent above tabs (not in any single panel)
- EKG sweep: 9s cycle with explicit dead time, JS-randomized beat pattern per cycle, opacity peak 0.30
- Serif (`Iowan Old Style` / `Georgia` stack) for brand wordmark only; Inter elsewhere
- No header chips for cost / openviking-latency / quota (removed as duplicate info)

---

### Task 3.5.1 — Design tokens (CSS variables) (~2 hrs)

**Files:**
- Modify: `apps/dashboard/app/globals.css`

Replace the current `:root` block (lines 9-100 approx) with the token system from the mockup's `:root` (search the mockup file for `--ink:` to find). Bring in:

- Surface tokens (`--ink`, `--surface`, `--surface-elevated`, `--surface-recessed`, `--surface-header`)
- Border tokens (`--moss-line`, `--moss-strong`, `--moss-faint`)
- Glass-pane effect tokens (`--rim-light`, `--rim-light-strong`, `--pane-shadow-deep`, `--pane-shadow-close`, `--pane-inner-dark`)
- Text tokens (`--parchment`, `--parchment-muted`, `--parchment-faint`)
- Brand + status (`--gold`, `--gold-bright`, `--gold-soft`, `--gold-glow`; `--pine`, `--pine-bright`, `--pine-soft`, `--pine-glow`; `--amber`, `--amber-soft`, `--amber-glow`; `--russet`, `--russet-soft`, `--russet-glow`; `--copper`)
- Dusk console (`--dusk-surface`, `--dusk-elevated`, `--dusk-line`, `--dusk-rim`, `--dusk-glow-warm`, `--dusk-glow-cool`)
- Motion (`--motion-fast`, `--motion-base`, `--ease`)
- Geometry (`--radius-card`, `--radius-chip`, `--radius-button`)
- Type stacks (`--serif`, `--sans`, `--mono`)

Remove the body-level `radial-gradient` background (the WCAG AA regression). Set `body` to solid `var(--ink)` and add the paper-grain `body::before` from the mockup.

Preserve the `.light` block for future light-mode support but update its values to match the new palette directionally.

Run `pnpm typecheck && pnpm lint && pnpm test` — all green, no visual regressions tolerated EXCEPT the body-bg color change.

### Task 3.5.2 — Lantern-mushroom logo component (~1 hr)

**Files:**
- Create: `apps/dashboard/components/brand/LanternMushroom.tsx`

Wrap the mockup's `<svg class="logo">` SVG (the one with the gold cap + cream windows + stem + pine ellipse) as a React component accepting a `size` prop (default 26). Export as default. Place under `components/brand/` since it's a brand asset distinct from observability or shell components.

### Task 3.5.3 — `SharedHeader` replacement + 4-tab routing (~2 hrs)

**Files:**
- Modify: `apps/dashboard/components/shell/SharedHeader.tsx`
- Modify: `apps/dashboard/components/shell/TabBar.tsx`
- Modify: `apps/dashboard/app/page.tsx` (root redirect)
- Create: `apps/dashboard/app/cost/page.tsx`
- Create: `apps/dashboard/app/health/page.tsx`
- Rename / restructure: `apps/dashboard/app/live/` → `apps/dashboard/app/runs/`

Replace the existing `SharedHeader` with the simplified mockup version: lantern mushroom + serif "AgenticOS" wordmark on left, search + settings on right (no chips). TabBar gets 4 entries: Runs (`/runs`), Cost (`/cost`), Health (`/health`), Memory (`/memory`).

Update root `app/page.tsx` to redirect `?tab=` query to the right path, default `/runs`.

The Phase 2/3 work created `app/live/page.tsx` — rename to `app/runs/page.tsx`. Stub `cost/` and `health/` pages with placeholder text; they'll get filled in by Task 3.5.6 + 3.5.7.

Update count badges per mockup (Runs: live count, Cost: today's spend, Health: warn count, Memory: total memories).

### Task 3.5.4 — `KpiVista` component with EKG (~3 hrs)

**Files:**
- Create: `apps/dashboard/components/shell/KpiVista.tsx`
- Create: `apps/dashboard/components/shell/EkgSweep.tsx`
- Create: `apps/dashboard/lib/hooks/use-kpi-data.ts`
- Modify: `apps/dashboard/app/layout.tsx` (insert KpiVista above the panels)

Port the mockup's `.kpi-vista` div as `KpiVista.tsx` — dusk-indigo surface, gold horizons, 4 KPI tiles, persistent live-meta indicator. Place ABOVE the tab content in the root layout so it shows across all tabs.

Port the EKG SVG + JS randomizer as `EkgSweep.tsx`. The randomizer should run as `useEffect` listening for `animationiteration` on the trace path. CSS animation drives the sweep; JS regenerates the path each cycle.

Data hook `useKpiData` fetches `/api/cost/today` for today's spend, `/api/tasks/queue-depth` for active run count, and surfaces vault file count + memories indexed (these last two need new API routes — file as follow-up tasks but stub for now).

### Task 3.5.5 — Glass-pane `Card` grammar (~3 hrs)

**Files:**
- Create: `apps/dashboard/components/ui/Card.tsx`
- Create: `apps/dashboard/components/ui/Pill.tsx`
- Create: `apps/dashboard/components/ui/Row.tsx`
- Create: `apps/dashboard/components/ui/BarRow.tsx`
- Create: `apps/dashboard/components/ui/Progress.tsx`
- Create: `apps/dashboard/components/ui/IconBtn.tsx`

Build the card system as composable primitives. `Card` accepts `lane?: "gold" | "pine" | "amber" | "russet"` to switch the top-spine color (per mockup's `.card.lane--*` classes). Use the multi-layer box-shadow from mockup for the glass pop. Include hover lift.

`Pill` has variants `ok` / `warn` / `err` / `run` / `stuck` matching mockup. `Row` is the 3-or-4-column grid pattern used inside cards. `BarRow` is the gold-fill bar used in OpenViking scopes. `Progress` is the labeled progress bar from Rate limits / System resources. `IconBtn` is the small square icon button with `alert` / `go` variants for retry / cancel / trigger-now actions.

Add Vitest tests for each: render with default props, hover state, lane variant where applicable.

### Task 3.5.6 — Re-skin existing Phase 3 cards (~3 hrs)

**Files:**
- Modify: `apps/dashboard/components/observability/QueueDepthPanel.tsx` → become `LiveRunsPanel.tsx` with elapsed time + stuck detection
- Modify: `apps/dashboard/components/observability/RecentErrorsPanel.tsx` → add retry button per row using new `IconBtn`
- Modify: `apps/dashboard/components/observability/CostBurndownChart.tsx` → use new `Card` grammar + gold sparkline ghost-fill

Each becomes a thin wrapper using the new `Card` + subcomponents. Maintains the same data hooks (`useQuery` against `/api/tasks/*`, `/api/cost/burndown`).

`QueueDepthPanel` → `LiveRunsPanel`: shows currently-executing tasks (not just counts), elapsed time per task, "stuck" classification when elapsed > 5 min without progress. Adds cancel icon button per row.

Move the re-skinned components into the appropriate route segment (Runs panel for live runs, Cost panel for burndown, etc.).

### Task 3.5.7 — New cards from mockup (~4 hrs)

**Files (one component each):**
- Create: `apps/dashboard/components/observability/ScheduledRunsPanel.tsx`
- Create: `apps/dashboard/components/observability/AgentHealthPanel.tsx`
- Create: `apps/dashboard/components/observability/SystemResourcesPanel.tsx`
- Create: `apps/dashboard/components/observability/ExternalServicesPanel.tsx`
- Create: `apps/dashboard/components/observability/BackupsPanel.tsx`
- Create: `apps/dashboard/components/observability/CostProjectionPanel.tsx`
- Create: `apps/dashboard/components/observability/OpenAICodexPanel.tsx`
- Create: `apps/dashboard/components/observability/OllamaPanel.tsx`
- Create: `apps/dashboard/components/observability/VaultIngestPanel.tsx`
- Create: `apps/dashboard/components/memory/RecentVaultChangesPanel.tsx`
- Create: `apps/dashboard/components/memory/SkillsCatalogPanel.tsx`

Each card has a paired API route (`/api/health/system`, `/api/cost/projection`, etc.) or reuses existing routes (`/api/tasks/recent-errors` for the recent activity feed). API routes that don't have a real backend yet should return a 501 stub (the dashboard renders the empty/loading state cleanly per the mockup).

Distribute components into the right panel pages:
- **Runs panel:** VaultIngestPanel, LiveRunsPanel (from 3.5.6), ScheduledRunsPanel, RecentErrorsPanel (from 3.5.6), Recent activity feed (re-skinned)
- **Cost panel:** CostBurndownChart (from 3.5.6), CostProjectionPanel, RateLimitsPanel (re-skin existing), OpenAICodexPanel, OllamaPanel
- **Health panel:** AgentHealthPanel, SystemResourcesPanel, ExternalServicesPanel, BackupsPanel
- **Memory panel:** OpenViking summary card, SkillsCatalogPanel, RecentVaultChangesPanel (3-card strip above the existing three-column browser)

### Task 3.5.8 — Acceptance + cleanup (~1 hr)

- [ ] Open every panel, confirm visual parity with mockup (compare against `docs/design/v2-ui-mockup.html`)
- [ ] Run `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` — all green
- [ ] Delete or archive orphaned files: original `components/layout/header.tsx`, `header-tabs.tsx` if still present
- [ ] Update the `tests/e2e/dashboard-load.spec.ts` paths from `/live` to `/runs` etc.

After Phase 3.5 lands, Phase 4 (Memory tab routes + components) builds against this new vocabulary — every card is already a `Card`, every pill is already a `Pill`, the Memory tab just adds the 3-column browser and 6 API routes on top.

---

## Phase 4 — Memory tab (~7 hrs)

Goal: Three-column browser, /api/memory/* routes, L0/L1/L2 progressive disclosure.

### Task 4.1: Add a Viking-client read shim

**Files:**
- Modify (or Create if it doesn't yet exist): `apps/dashboard/lib/api/viking.ts`

> **Endpoint shapes verified against `docs/reference/openviking-v0.3.19-openapi.json` on 2026-05-28.** Real Viking endpoints use `uri` (not `path`), `content/{abstract,overview,read}` (not bare `/abstract` etc.), and require tenant headers `X-OpenViking-Account` and `X-OpenViking-User`. There is no batch `/abstracts` endpoint — the client fans out one `content/abstract` call per child returned by `fs/ls`. Trajectory comes from `observer/retrieval` (no params) filtered client-side, with `relations/build_graph` (POST) as a richer fallback.

- [ ] **Step 1: Locate the existing Viking client**

Run: `grep -rn "viking\|openviking" apps/dashboard/lib/ | head -20`. Spec 1 left a client somewhere. If a client already exists, modify it; otherwise create `apps/dashboard/lib/api/viking.ts`. Reuse whatever pattern Spec 1 established for tenant headers if any.

- [ ] **Step 2: Implement the read shim**

```ts
// apps/dashboard/lib/api/viking.ts
import "server-only";

const BASE    = process.env.OPENVIKING_ENDPOINT ?? "http://openviking:1933";
const API_KEY = process.env.OPENVIKING_API_KEY  ?? "";
const ACCOUNT = process.env.OPENVIKING_ACCOUNT  ?? "agenticos";
const USER    = process.env.OPENVIKING_USER     ?? "deploy";

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "X-OpenViking-Account": ACCOUNT,
    "X-OpenViking-User":    USER,
  };
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { headers: headers(), cache: "no-store" });
  if (!r.ok) throw new Error(`Viking GET ${path} -> HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Viking POST ${path} -> HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

// Types — adapt to actual Viking response shapes when the implementer
// observes the first real response. Field names below are based on the
// OpenViking v0.3.19 conventions but should be verified.
export interface TreeNode { uri: string; name: string; kind: "scope" | "dir" | "file"; }
export interface FsEntry  { uri: string; name: string; is_dir: boolean; }
export interface Abstract { uri: string; name: string; abstract: string; }
export interface Overview { uri: string; overview: string; }
export interface Detail   { uri: string; content: string; total_offset: number; offset: number; limit: number; }
export interface Retrieval { uri: string; session_id: string; agent: string; at: string; query?: string; }
export interface GraphData {
  nodes: { id: string; kind: "uri" | "session" | "agent"; label: string; size: number }[];
  links: { source: string; target: string; weight: number; at: string }[];
}

const enc = encodeURIComponent;

export const vikingFsTree   = (uri: string)                          => get<{ nodes: TreeNode[] }>(`/api/v1/fs/tree?uri=${enc(uri)}`);
export const vikingFsLs     = (uri: string)                          => get<{ entries: FsEntry[] }>(`/api/v1/fs/ls?uri=${enc(uri)}&simple=true`);
export const vikingAbstract = (uri: string)                          => get<Abstract>(`/api/v1/content/abstract?uri=${enc(uri)}`);
export const vikingOverview = (uri: string)                          => get<Overview>(`/api/v1/content/overview?uri=${enc(uri)}`);
export const vikingDetail   = (uri: string, offset = 0, limit = 8192) => get<Detail>(`/api/v1/content/read?uri=${enc(uri)}&offset=${offset}&limit=${limit}`);
export const vikingRetrieval = ()                                    => get<{ events: Retrieval[] }>(`/api/v1/observer/retrieval`);
export const vikingBuildGraph = (root_uri: string, since: string)    => post<GraphData>(`/api/v1/relations/build_graph`, { root_uri, since });
export const vikingSearchFind = (query: string, target_uri?: string) => post<{ items: Abstract[] }>(`/api/v1/search/find`, { query, target_uri });
export const vikingStatsMemories = (category?: string)               => get<{ counts: Record<string, number> }>(`/api/v1/stats/memories${category ? `?category=${enc(category)}` : ""}`);
export const vikingDashboardSummary = (tz = "America/New_York")      => get<Record<string, unknown>>(`/api/v1/console/dashboard/summary?timezone=${enc(tz)}`);
```

**Note on `abstracts` (the list view):** there is no batch-abstracts endpoint in v0.3.19. The dashboard route `/api/memory/abstracts` will call `vikingFsLs` then fan out one `vikingAbstract` per file child, in parallel, with a `Promise.all` cap of e.g. 8 to avoid hammering Ollama. The route handler in Task 4.2 covers this.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/lib/api/viking.ts
git -c commit.gpgsign=false commit -m "feat(dashboard): viking read-client shim for memory tab"
```

### Task 4.2: Create the six memory API routes

**Files:**
- Create: `apps/dashboard/app/api/memory/tree/route.ts`
- Create: `apps/dashboard/app/api/memory/abstracts/route.ts`
- Create: `apps/dashboard/app/api/memory/overview/route.ts`
- Create: `apps/dashboard/app/api/memory/detail/route.ts`
- Create: `apps/dashboard/app/api/memory/trajectory/route.ts`
- Create: `apps/dashboard/app/api/ingest/status/route.ts`

> **Routes rewritten 2026-05-28 against actual Viking v0.3.19 OpenAPI** (see `docs/reference/openviking-v0.3.19-openapi.json`). Real shapes use `uri` query, `content/{abstract,overview,read}` paths, offset/limit pagination (not chunk index), POST for `search/find` and `relations/build_graph`. No batch-abstracts endpoint — `/api/memory/abstracts` fans out one `content/abstract` per `fs/ls` child.

- [ ] **Step 1: Implement `/api/memory/tree`** (normalizes scope to `viking://` URI)

```ts
// apps/dashboard/app/api/memory/tree/route.ts
import { NextResponse } from "next/server";
import { vikingFsTree } from "@/lib/api/viking";

export async function GET(req: Request) {
  const scope = new URL(req.url).searchParams.get("scope") ?? "resources";
  const uri = scope.startsWith("viking://") ? scope : `viking://${scope}`;
  try {
    return NextResponse.json(await vikingFsTree(uri));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Implement `/api/memory/abstracts`** (fan-out — there is no batch endpoint)

```ts
// apps/dashboard/app/api/memory/abstracts/route.ts
import { NextResponse } from "next/server";
import { vikingFsLs, vikingAbstract } from "@/lib/api/viking";

const PARALLEL_CAP = 8;

async function pLimit<T, R>(items: T[], cap: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

export async function GET(req: Request) {
  const uri = new URL(req.url).searchParams.get("uri");
  if (!uri) return NextResponse.json({ error: "uri required" }, { status: 400 });
  try {
    const { entries } = await vikingFsLs(uri);
    const files = entries.filter((entry) => !entry.is_dir);
    const items = await pLimit(files, PARALLEL_CAP, async (entry) => {
      try {
        const a = await vikingAbstract(entry.uri);
        return { uri: entry.uri, name: entry.name, abstract: a.abstract };
      } catch {
        return { uri: entry.uri, name: entry.name, abstract: "" };
      }
    });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 3: Implement `/api/memory/overview`** (1:1 proxy)

```ts
// apps/dashboard/app/api/memory/overview/route.ts
import { NextResponse } from "next/server";
import { vikingOverview } from "@/lib/api/viking";

export async function GET(req: Request) {
  const uri = new URL(req.url).searchParams.get("uri");
  if (!uri) return NextResponse.json({ error: "uri required" }, { status: 400 });
  try {
    return NextResponse.json(await vikingOverview(uri));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 4: Implement `/api/memory/detail`** (offset/limit pagination matching upstream)

```ts
// apps/dashboard/app/api/memory/detail/route.ts
import { NextResponse } from "next/server";
import { vikingDetail } from "@/lib/api/viking";

const DEFAULT_LIMIT = 8192;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const uri = sp.get("uri");
  const offset = Number(sp.get("offset") ?? "0");
  const limit  = Number(sp.get("limit")  ?? `${DEFAULT_LIMIT}`);
  if (!uri) return NextResponse.json({ error: "uri required" }, { status: 400 });
  if (!Number.isFinite(offset) || offset < 0) {
    return NextResponse.json({ error: "offset must be a non-negative integer" }, { status: 400 });
  }
  if (!Number.isFinite(limit) || limit <= 0 || limit > 65536) {
    return NextResponse.json({ error: "limit must be in (0, 65536]" }, { status: 400 });
  }
  try {
    return NextResponse.json(await vikingDetail(uri, offset, limit));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 5: Implement `/api/memory/trajectory`** (try `relations/build_graph` first, fall back to filtered observer events)

```ts
// apps/dashboard/app/api/memory/trajectory/route.ts
import { NextResponse } from "next/server";
import { vikingBuildGraph, vikingRetrieval } from "@/lib/api/viking";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const uri = sp.get("uri");
  const since = sp.get("since") ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  if (!uri) return NextResponse.json({ error: "uri required" }, { status: 400 });

  // Richer graph first — falls back if Viking's relations service is empty or unavailable.
  try {
    const graph = await vikingBuildGraph(uri, since);
    if (graph?.nodes?.length) return NextResponse.json(graph);
  } catch { /* fall through */ }

  try {
    const { events } = await vikingRetrieval();
    const sinceMs = Date.parse(since);
    const relevant = events.filter((ev) => ev.uri === uri && Date.parse(ev.at) >= sinceMs);
    const sessions = new Map<string, number>();
    for (const ev of relevant) sessions.set(ev.session_id, (sessions.get(ev.session_id) ?? 0) + 1);
    return NextResponse.json({
      nodes: [
        { id: uri, kind: "uri", label: uri.split("/").pop() ?? uri, size: relevant.length },
        ...Array.from(sessions.entries()).map(([id, n]) => ({
          id, kind: "session" as const, label: id.slice(0, 8), size: n,
        })),
      ],
      links: relevant.map((ev) => ({ source: ev.session_id, target: uri, weight: 1, at: ev.at })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, available: false }, { status: 503 });
  }
}
```

- [ ] **Step 6: Implement `/api/ingest/status`**

```ts
// apps/dashboard/app/api/ingest/status/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string; started_at: string; status: string; metadata: Record<string, number>;
  }>(
    `SELECT id, started_at, status, metadata
     FROM tasks
     WHERE kind = 'vault-ingest'
     ORDER BY started_at DESC
     LIMIT 1`,
  );
  return NextResponse.json(rows[0] ?? null);
}
```

- [ ] **Step 7: Commit all six**

```bash
git add apps/dashboard/app/api/memory/ apps/dashboard/app/api/ingest/
git -c commit.gpgsign=false commit -m "feat(dashboard): memory tab API routes"
```

### Task 4.3: TanStack hooks for the memory routes

**Files:**
- Create: `apps/dashboard/lib/hooks/use-memory-tree.ts`
- Create: `apps/dashboard/lib/hooks/use-memory-abstracts.ts`
- Create: `apps/dashboard/lib/hooks/use-memory-detail.ts`
- Create: `apps/dashboard/lib/hooks/use-trajectory.ts`

- [ ] **Step 1: Implement the hooks (one file each)**

```ts
// apps/dashboard/lib/hooks/use-memory-tree.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { TreeNode } from "@/lib/api/viking";

export function useMemoryTree(scope: string) {
  return useQuery<{ nodes: TreeNode[] }>({
    queryKey: ["memory-tree", scope],
    queryFn: async () => (await fetch(`/api/memory/tree?scope=${encodeURIComponent(scope)}`)).json(),
    staleTime: 30_000,
  });
}
```

```ts
// apps/dashboard/lib/hooks/use-memory-abstracts.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { Abstract } from "@/lib/api/viking";

export function useMemoryAbstracts(uri: string | null) {
  return useQuery<{ items: Abstract[] }>({
    queryKey: ["memory-abstracts", uri],
    enabled: !!uri,
    queryFn: async () => (await fetch(`/api/memory/abstracts?uri=${encodeURIComponent(uri!)}`)).json(),
    staleTime: 30_000,
  });
}
```

```ts
// apps/dashboard/lib/hooks/use-memory-detail.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { Overview, Detail } from "@/lib/api/viking";

export function useMemoryOverview(uri: string | null) {
  return useQuery<Overview>({
    queryKey: ["memory-overview", uri],
    enabled: !!uri,
    queryFn: async () => (await fetch(`/api/memory/overview?uri=${encodeURIComponent(uri!)}`)).json(),
    staleTime: 60_000,
  });
}

export function useMemoryDetail(uri: string | null, chunk: number) {
  return useQuery<Detail>({
    queryKey: ["memory-detail", uri, chunk],
    enabled: !!uri,
    queryFn: async () => (await fetch(`/api/memory/detail?uri=${encodeURIComponent(uri!)}&chunk=${chunk}`)).json(),
    staleTime: 60_000,
  });
}
```

```ts
// apps/dashboard/lib/hooks/use-trajectory.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { GraphData } from "@/lib/api/viking";

export function useTrajectory(uri: string | null, since: string) {
  return useQuery<GraphData & { available?: boolean }>({
    queryKey: ["memory-trajectory", uri, since],
    enabled: !!uri,
    retry: false,
    queryFn: async () => {
      const r = await fetch(`/api/memory/trajectory?uri=${encodeURIComponent(uri!)}&since=${encodeURIComponent(since)}`);
      if (r.status === 503) return { nodes: [], links: [], available: false };
      return r.json();
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/lib/hooks/
git -c commit.gpgsign=false commit -m "feat(dashboard): memory TanStack hooks"
```

### Task 4.4: `CategoryBrowser` (column 1)

**Files:**
- Create: `apps/dashboard/components/memory/CategoryBrowser.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/dashboard/components/memory/CategoryBrowser.tsx
"use client";
import { useQueryState } from "nuqs";
import { useMemoryTree } from "@/lib/hooks/use-memory-tree";

const SCOPES = ["resources", "user", "agent", "session"] as const;

export function CategoryBrowser({
  onSelect,
}: {
  onSelect: (uri: string) => void;
}) {
  const [scope, setScope] = useQueryState("scope", { defaultValue: "resources" });
  const { data, isLoading } = useMemoryTree(scope);

  return (
    <aside className="border-r p-3 overflow-y-auto text-sm">
      <div className="flex gap-1 mb-2 text-xs">
        {SCOPES.map((s) => (
          <button key={s} onClick={() => setScope(s)}
            className={`px-2 py-0.5 rounded ${s === scope ? "bg-white/10" : "opacity-60"}`}>
            {s}
          </button>
        ))}
      </div>
      {isLoading && <p className="opacity-60">Loading…</p>}
      <ul className="space-y-0.5">
        {(data?.nodes ?? []).map((n) => (
          <li key={n.uri}>
            <button onClick={() => onSelect(n.uri)} className="text-left hover:underline truncate w-full">
              <span className="opacity-70">{n.kind === "dir" ? "📁" : "📄"}</span> {n.name}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/components/memory/CategoryBrowser.tsx
git -c commit.gpgsign=false commit -m "feat(dashboard): memory CategoryBrowser"
```

### Task 4.5: `AbstractList` (column 2)

**Files:**
- Create: `apps/dashboard/components/memory/AbstractList.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/dashboard/components/memory/AbstractList.tsx
"use client";
import { useMemoryAbstracts } from "@/lib/hooks/use-memory-abstracts";

export function AbstractList({
  parentUri,
  selectedUri,
  onSelect,
}: {
  parentUri: string | null;
  selectedUri: string | null;
  onSelect: (uri: string) => void;
}) {
  const { data, isLoading, isError } = useMemoryAbstracts(parentUri);
  if (!parentUri) return <div className="p-4 text-sm opacity-60">Select a category to see abstracts.</div>;
  if (isLoading) return <div className="p-4 text-sm opacity-60">Loading…</div>;
  if (isError) return <div className="p-4 text-sm text-red-300">Failed to load abstracts.</div>;
  const items = data?.items ?? [];
  if (items.length === 0) return <div className="p-4 text-sm opacity-60">Empty.</div>;
  return (
    <div className="border-r overflow-y-auto">
      <ul>
        {items.map((it) => (
          <li key={it.uri}>
            <button
              onClick={() => onSelect(it.uri)}
              className={`block w-full text-left p-3 border-b hover:bg-white/5 ${it.uri === selectedUri ? "bg-white/10" : ""}`}
            >
              <div className="text-sm font-medium truncate">{it.name}</div>
              <div className="text-xs opacity-70 line-clamp-2">{it.abstract}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/components/memory/AbstractList.tsx
git -c commit.gpgsign=false commit -m "feat(dashboard): memory AbstractList"
```

### Task 4.6: `DetailView` (column 3, L1 + lazy L2)

**Files:**
- Create: `apps/dashboard/components/memory/DetailView.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/dashboard/components/memory/DetailView.tsx
"use client";
import { useState } from "react";
import { useMemoryOverview, useMemoryDetail } from "@/lib/hooks/use-memory-detail";
import { RetrievalTrajectoryGraph } from "./RetrievalTrajectoryGraph";

type Pane = "detail" | "trace";

export function DetailView({ uri }: { uri: string | null }) {
  const [pane, setPane] = useState<Pane>("detail");
  const [chunk, setChunk] = useState(0);
  const [showFull, setShowFull] = useState(false);

  const overview = useMemoryOverview(uri);
  const full = useMemoryDetail(showFull ? uri : null, chunk);

  if (!uri) return <div className="p-6 text-sm opacity-60">Select an item to see details.</div>;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex gap-1 border-b text-xs p-2">
        {(["detail", "trace"] as const).map((p) => (
          <button key={p} onClick={() => setPane(p)}
            className={`px-2 py-0.5 rounded ${pane === p ? "bg-white/10" : "opacity-60"}`}>
            {p === "detail" ? "Detail" : "Trace usage"}
          </button>
        ))}
      </div>
      {pane === "detail" ? (
        <div className="overflow-y-auto p-4 text-sm leading-6">
          {overview.isLoading && <p className="opacity-60">Loading overview…</p>}
          {overview.data?.overview && <pre className="whitespace-pre-wrap font-sans">{overview.data.overview}</pre>}
          {!showFull && (
            <button className="mt-4 px-3 py-1 border rounded text-xs"
              onClick={() => setShowFull(true)}>Load full L2</button>
          )}
          {showFull && (
            <>
              <pre className="whitespace-pre-wrap font-mono text-xs mt-4">{full.data?.content}</pre>
              {full.data && full.data.total_chunks > 1 && (
                <div className="flex gap-2 mt-2">
                  <button disabled={chunk === 0} onClick={() => setChunk(c => Math.max(0, c - 1))}>Prev</button>
                  <span className="text-xs opacity-60">{chunk + 1} / {full.data.total_chunks}</span>
                  <button disabled={chunk + 1 >= full.data.total_chunks} onClick={() => setChunk(c => c + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <RetrievalTrajectoryGraph uri={uri} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Stub `RetrievalTrajectoryGraph` for now**

```tsx
// apps/dashboard/components/memory/RetrievalTrajectoryGraph.tsx
"use client";
export function RetrievalTrajectoryGraph({ uri }: { uri: string }) {
  return (
    <div className="p-6 text-sm opacity-60">
      Trajectory for {uri} — implemented in Phase 5.
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/components/memory/
git -c commit.gpgsign=false commit -m "feat(dashboard): memory DetailView with L1/L2 + stub trajectory"
```

### Task 4.7: Wire the Memory tab page

**Files:**
- Modify: `apps/dashboard/app/(tabs)/memory/page.tsx`

- [ ] **Step 1: Compose the three columns**

```tsx
// apps/dashboard/app/(tabs)/memory/page.tsx
"use client";
import { useQueryState } from "nuqs";
import { CategoryBrowser } from "@/components/memory/CategoryBrowser";
import { AbstractList } from "@/components/memory/AbstractList";
import { DetailView } from "@/components/memory/DetailView";

export default function MemoryPage() {
  const [parentUri, setParentUri] = useQueryState("uri");
  const [selectedUri, setSelectedUri] = useQueryState("item");

  return (
    <div className="grid grid-cols-12 h-[calc(100vh-7rem)]">
      <div className="col-span-3">
        <CategoryBrowser onSelect={setParentUri} />
      </div>
      <div className="col-span-4">
        <AbstractList parentUri={parentUri} selectedUri={selectedUri} onSelect={setSelectedUri} />
      </div>
      <div className="col-span-5">
        <DetailView uri={selectedUri} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Visual smoke test**

Run: `pnpm dev` → `/memory` → see three columns. Pick a scope, see tree. Click a node, see abstracts. Click an abstract, see overview + "Load full L2".

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/app/(tabs)/memory/
git -c commit.gpgsign=false commit -m "feat(dashboard): memory tab three-column page"
```

---

## Phase 5 — Retrieval trajectories (~4 hrs)

Goal: Replace the `RetrievalTrajectoryGraph` stub with a real `react-force-graph-2d` view backed by Viking's DebugService.

### Task 5.1: Verify trajectory endpoint shape — **ANSWERED**

> Resolved 2026-05-28 via `docs/reference/openviking-v0.3.19-openapi.json`. Viking v0.3.19 exposes two relevant endpoints: `GET /api/v1/observer/retrieval` (recent retrieval events, no query params — filter client-side) and `POST /api/v1/relations/build_graph` (richer graph response with body `{root_uri, since}`). The route handler in Task 4.2 Step 5 tries `build_graph` first and falls back to `observer/retrieval`. No further verification step needed; proceed to 5.2.

- [ ] **Step 1: Sanity-check both endpoints with curl from Droplet**

Run on Droplet:
```bash
APIKEY="$(jq -r .server.root_api_key /opt/agenticos/openviking-config/ov.conf)"
HDRS=(-H "Authorization: Bearer $APIKEY" -H "X-OpenViking-Account: agenticos" -H "X-OpenViking-User: deploy")
curl -fsS "http://localhost:1933/api/v1/observer/retrieval" "${HDRS[@]}" | jq . | head -40
curl -fsS -X POST "http://localhost:1933/api/v1/relations/build_graph" "${HDRS[@]}" -H "Content-Type: application/json" -d '{"root_uri":"viking://resources","since":"2026-04-28T00:00:00Z"}' | jq . | head -40
```

If the response shapes don't match the `Retrieval` / `GraphData` types in `lib/api/viking.ts`, update the types in one place — the rest of the code paths normalize through that file.

### Task 5.2: Implement `RetrievalTrajectoryGraph`

**Files:**
- Modify: `apps/dashboard/components/memory/RetrievalTrajectoryGraph.tsx`

- [ ] **Step 1: Replace the stub**

```tsx
// apps/dashboard/components/memory/RetrievalTrajectoryGraph.tsx
"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useTrajectory } from "@/lib/hooks/use-trajectory";

// react-force-graph-2d is canvas-based; load it client-only.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const RANGES = [
  { label: "7d",  iso: () => new Date(Date.now() -  7 * 86400_000).toISOString() },
  { label: "30d", iso: () => new Date(Date.now() - 30 * 86400_000).toISOString() },
  { label: "90d", iso: () => new Date(Date.now() - 90 * 86400_000).toISOString() },
];

export function RetrievalTrajectoryGraph({ uri }: { uri: string }) {
  const [rangeIdx, setRangeIdx] = useState(1);
  const since = RANGES[rangeIdx].iso();
  const { data, isLoading } = useTrajectory(uri, since);

  if (isLoading) return <div className="p-6 text-sm opacity-60">Loading trajectory…</div>;
  if (data?.available === false) {
    return (
      <div className="p-6 text-sm opacity-60">
        Retrieval trajectories not available with this Viking version.
      </div>
    );
  }
  if (!data || data.nodes.length === 0) {
    return <div className="p-6 text-sm opacity-60">No retrievals in this window.</div>;
  }

  const colorFor = (kind: string) =>
    kind === "uri" ? "#7dd3fc" : kind === "session" ? "#fda4af" : "#86efac";

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 text-xs p-2 border-b">
        {RANGES.map((r, i) => (
          <button key={r.label} onClick={() => setRangeIdx(i)}
            className={`px-2 py-0.5 rounded ${i === rangeIdx ? "bg-white/10" : "opacity-60"}`}>
            {r.label}
          </button>
        ))}
      </div>
      <div className="flex-1 relative">
        <ForceGraph2D
          graphData={{ nodes: data.nodes, links: data.links }}
          nodeLabel={(n: any) => `${n.kind}: ${n.label}`}
          nodeRelSize={4}
          nodeVal={(n: any) => n.size ?? 1}
          nodeColor={(n: any) => colorFor(n.kind)}
          linkColor={() => "rgba(255,255,255,0.25)"}
          linkWidth={(l: any) => Math.max(0.5, Math.min(3, l.weight))}
          backgroundColor="transparent"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify locally**

Run: `pnpm dev` → `/memory` → select an item → click "Trace usage". You should see either a force-graph or one of the empty states.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/components/memory/RetrievalTrajectoryGraph.tsx
git -c commit.gpgsign=false commit -m "feat(dashboard): wire RetrievalTrajectoryGraph to Viking DebugService"
```

### Task 5.3: Degrade gracefully when DebugService is missing

- [ ] **Step 1: Add a Vitest unit test**

```tsx
// apps/dashboard/components/memory/RetrievalTrajectoryGraph.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/hooks/use-trajectory", () => ({
  useTrajectory: () => ({ data: { nodes: [], links: [], available: false }, isLoading: false }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { RetrievalTrajectoryGraph } from "./RetrievalTrajectoryGraph";

describe("RetrievalTrajectoryGraph", () => {
  it("shows degraded state when Viking debug endpoint unavailable", () => {
    render(<RetrievalTrajectoryGraph uri="viking://agent/skills/x.md" />);
    expect(screen.getByText(/not available/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd apps/dashboard && pnpm test components/memory/RetrievalTrajectoryGraph.test.tsx`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/components/memory/RetrievalTrajectoryGraph.test.tsx
git -c commit.gpgsign=false commit -m "test(dashboard): trajectory graph degraded-state test"
```

---

## Phase 6 — Hardening + acceptance test (~3 hrs)

Goal: Run the spec §10 acceptance criteria as checks (automated where possible), and bake in observability of the failure modes from spec §7.

### Task 6.1: P95-load assertion via Playwright

**Files:**
- Create: `apps/dashboard/tests/e2e/dashboard-load.spec.ts`

- [ ] **Step 1: Write Playwright test**

```ts
// apps/dashboard/tests/e2e/dashboard-load.spec.ts
import { test, expect } from "@playwright/test";

test("loads /live within 1500ms", async ({ page }) => {
  const t0 = Date.now();
  await page.goto("/live", { waitUntil: "load" });
  expect(Date.now() - t0).toBeLessThan(1500);
});

test("loads /memory within 1500ms", async ({ page }) => {
  const t0 = Date.now();
  await page.goto("/memory", { waitUntil: "load" });
  expect(Date.now() - t0).toBeLessThan(1500);
});
```

- [ ] **Step 2: Run locally**

Run: `cd apps/dashboard && pnpm test:e2e tests/e2e/dashboard-load.spec.ts`
Expected: both pass. Note: in production env, run against Cloudflare Access endpoint after auth.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/tests/e2e/dashboard-load.spec.ts
git -c commit.gpgsign=false commit -m "test(e2e): dashboard tab load latency"
```

### Task 6.2: Live + Memory tabs fail independently

**Files:**
- Create: `apps/dashboard/tests/e2e/tab-isolation.spec.ts`

- [ ] **Step 1: Implement**

```ts
// apps/dashboard/tests/e2e/tab-isolation.spec.ts
import { test, expect } from "@playwright/test";

test("Memory tab still renders when /api/memory/tree returns 502", async ({ page }) => {
  await page.route("**/api/memory/tree*", (route) =>
    route.fulfill({ status: 502, body: JSON.stringify({ error: "viking down" }) }),
  );
  await page.goto("/memory");
  // CategoryBrowser doesn't crash; main shell still visible.
  await expect(page.getByRole("tab", { name: "Live Ops" })).toBeVisible();
});

test("Live tab still renders when one panel API returns 500", async ({ page }) => {
  await page.route("**/api/tasks/queue-depth", (route) => route.fulfill({ status: 500 }));
  await page.goto("/live");
  await expect(page.getByRole("tab", { name: "Memory" })).toBeVisible();
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm test:e2e tests/e2e/tab-isolation.spec.ts
git add apps/dashboard/tests/e2e/tab-isolation.spec.ts
git -c commit.gpgsign=false commit -m "test(e2e): tab isolation under API failure"
```

### Task 6.3: Acceptance checklist documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-05-25-v2-unified-dashboard-design.md`

- [ ] **Step 1: Append an "Acceptance results" section**

Add at the bottom of the spec file (above "End of design"):

```markdown
## 14. Acceptance results

| # | Criterion | Verification | Status |
|---|-----------|--------------|--------|
| 1 | Hourly cron runs 7 days, ≥1 file ingested | Phase 1.7 + `psql … FROM tasks WHERE kind='vault-ingest'` | <pending> |
| 2 | Obsidian edit → Memory tab within ~75 min | Manual smoke test, log time delta | <pending> |
| 3 | No external API spend over Spec 1 baseline | Compare `SELECT SUM(cost_cents) FROM calls WHERE provider='openai'` over 7d windows | <pending> |
| 4 | Deep link to either tab ≤ 1500 ms P95 | `tests/e2e/dashboard-load.spec.ts` | automated |
| 5 | Memory tab drills 3 levels in all 4 scopes | Manual click-through | <pending> |
| 6 | Trace usage opens force-graph for ≥1 URI ≥5 events | Manual + screenshot | <pending> |
| 7 | Any one chip failing does not block dashboard | `tests/e2e/tab-isolation.spec.ts` | automated |
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-25-v2-unified-dashboard-design.md
git -c commit.gpgsign=false commit -m "docs: v2 acceptance results scaffold"
```

### Task 6.4: Final integration sweep

- [ ] **Step 1: Full test suite**

Run: `pnpm -w typecheck && pnpm -w lint && pnpm -w test && cd apps/dashboard && pnpm test:e2e`
Expected: green across the board. Known pre-existing typecheck gaps (Spec 1 carryover) acceptable only if they are not in files touched by this plan.

- [ ] **Step 2: Open PR**

Run:
```bash
gh pr create --title "feat: v2 unified dashboard (memory tab + tabbed shell)" \
  --body "$(cat <<'EOF'
## Summary
- Adds hourly vault → Viking ingester (Hermes Python task).
- Reconfigures Viking to use Ollama for embeddings + VLM (no external spend).
- Rebuilds dashboard as a tabbed shell with shared header (cost / health / quota).
- Adds Memory tab with three-column browse, L0/L1/L2 disclosure, retrieval-trajectory graph.
- Implements 7 new dashboard API routes and 4 new TanStack hooks.

Implements: docs/superpowers/specs/2026-05-25-v2-unified-dashboard-design.md
Plan: docs/plans/v2-unified-dashboard.md

## Test plan
- [x] Unit: `pnpm -w test`
- [x] E2E: `pnpm test:e2e` (load latency, tab isolation)
- [ ] Production smoke (after deploy): edit a vault file, see it in Memory tab within 75 min
- [ ] Production smoke: cost ledger shows no new external-API line items over 7 days

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes (run before claiming done)

**Spec coverage:**
- §3 locked decisions all reflected (Phases 0–5 lock them in code).
- §4 architecture delta — ingester (Phase 1), Viking LLM (Phase 0), tabbed shell (Phase 2), Live polish (Phase 3), Memory tab (Phase 4), trajectories (Phase 5). ✓
- §5 components — every file in the §5 list is created in a specific task. ✓
- §6 data flow scenarios — A and C exercised by Task 1.7 + Phase 4 manual smoke; B exercised opportunistically as Curator sessions run. ✓
- §7 failure modes — Tasks 6.1 / 6.2 / 5.3 cover the testable ones; Ollama-down is the operational responsibility of the Phase 0 verification. ✓
- §8 out of scope — nothing in the plan crosses these lines (no dashboard authoring, no multi-agent UI, no public sharing). ✓
- §9 open questions — Task 0.1 / 0.2 resolve #1; Task 5.1 resolves #2; Task 1.1 implements #3 as a new table; Task 4.2 step 4 handles #4 with chunk pagination. ✓
- §10 acceptance — Task 6.3 codifies the checklist; Tasks 6.1 / 6.2 automate criteria 4 and 7. ✓
- §11 phasing — plan mirrors the 7-phase split.

**Placeholder scan:** every code step contains complete content. The only `TBD`-style note is the (intentional) "verify the endpoint shape during Phase 5.1" — that is an investigation step, not a deferred decision.

**Type consistency:** `Trajectory`, `Detail`, `Abstract`, `Overview`, `TreeNode` defined once in `lib/api/viking.ts`, imported elsewhere. Hook names match the file names. The `IngestRow` dataclass and `VaultItem` dataclass have stable field names across tasks 1.2–1.5.

---

## Execution

Plan complete and saved to `docs/plans/v2-unified-dashboard.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task with two-stage review (spec → quality) between tasks.
**2. Inline Execution** — Execute tasks in this session in batched checkpoints.

Pick one and I'll proceed.
