# Dev/GitHub PR-Triage Connector Implementation Plan

> **⚠️ SUPERSEDED — Hermes runtime retired (ADR 0006).** This Hermes-cron plan
> is replaced by the Paperclip-native design
> [`2026-06-10-github-plugin-pr-triage-paperclip-design.md`](../specs/2026-06-10-github-plugin-pr-triage-paperclip-design.md)
> (a deterministic `@agenticos/github-plugin` job). Preserved for history; do
> not execute.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Hermes cron task (`pr_triage`) that polls open PRs across the GitHub org, classifies each, writes a living digest note to the vault, and records a `pr-triage` row in Postgres.

**Architecture:** A new cron task mirroring `daily_brief` — `fetch` (GitHub REST) → `assess` (pure function) → `render` (deterministic markdown + optional local-SLM intro) → `write` (vault note) → `record` (Postgres `tasks`). No new container; registered like the other cron jobs and run by `hermes-gateway`. Read-only on GitHub.

**Tech Stack:** Python 3 (`agenticos_hermes` package), `httpx` for GitHub REST + Ollama, Postgres via `agenticos_hermes.db.connect()`, pytest with mocked `httpx`.

**Spec:** `docs/superpowers/specs/2026-06-08-dev-github-pr-triage-connector-design.md`

**Conventions (match the repo):**
- Run tests from the package dir: `cd packages/agenticos-hermes && PYTHONPATH=src .venv/bin/python -m pytest <path> -v`
- Commit with: `PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit` and end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Never push `main`; branch off `main`; squash-merge.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/agenticos-hermes/src/agenticos_hermes/workers/github_client.py` | Read-only GitHub REST client: discover open PRs across the org + per-PR detail, checks, reviews. |
| `packages/agenticos-hermes/src/agenticos_hermes/tasks/pr_triage.py` | Orchestrator + pure `assess_pr` + `render_digest` + vault write + Postgres recorders. |
| `packages/agenticos-hermes/wrappers/cron-scripts/pr-triage.sh` | Cron wrapper (`--no-agent`) invoking the Python entrypoint. |
| `packages/agenticos-hermes/tests/test_pr_triage.py` | Unit tests: client (mocked httpx), assess, render, orchestrator. |
| `infra/scripts/register-cron-jobs.sh` | **Modify** — register the `pr-triage` job. |
| `docker-compose.yml` | **Modify** — add `GITHUB_TOKEN` + `GITHUB_ORG` env to `hermes-agent` and `hermes-gateway`. |

---

## Task 1: GitHub client — discover open PRs across the org

**Files:**
- Create: `packages/agenticos-hermes/src/agenticos_hermes/workers/github_client.py`
- Test: `packages/agenticos-hermes/tests/test_pr_triage.py`

- [ ] **Step 1: Write the failing test**

Create `packages/agenticos-hermes/tests/test_pr_triage.py`:

```python
"""Tests for the pr-triage connector. All GitHub/Ollama/DB calls are mocked."""
from __future__ import annotations

from datetime import datetime, timezone

from agenticos_hermes.workers import github_client as gh


class _Resp:
    def __init__(self, json_body, status=200, headers=None):
        self._json = json_body
        self.status_code = status
        self.headers = headers or {}

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def test_search_open_prs_parses_items(monkeypatch):
    captured = {}

    class _Client:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, url, headers=None, params=None):
            captured["url"] = url
            captured["params"] = params
            captured["auth"] = headers.get("Authorization")
            return _Resp(
                {
                    "items": [
                        {
                            "number": 7,
                            "title": "Fix thing",
                            "user": {"login": "josh"},
                            "draft": False,
                            "updated_at": "2026-06-01T00:00:00Z",
                            "html_url": "https://github.com/o/r/pull/7",
                            "repository_url": "https://api.github.com/repos/o/r",
                        }
                    ]
                },
                headers={},  # no Link header -> single page
            )

    monkeypatch.setattr(gh.httpx, "Client", _Client)
    client = gh.GitHubClient(token="t", org="o")
    prs = client.search_open_prs()

    assert captured["auth"] == "Bearer t"
    assert "search/issues" in captured["url"]
    assert "org:o is:pr is:open archived:false" in captured["params"]["q"]
    assert len(prs) == 1
    assert prs[0]["repo_full_name"] == "o/r"
    assert prs[0]["number"] == 7
    assert prs[0]["author"] == "josh"
    assert prs[0]["draft"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agenticos-hermes && PYTHONPATH=src .venv/bin/python -m pytest tests/test_pr_triage.py::test_search_open_prs_parses_items -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agenticos_hermes.workers.github_client'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/agenticos-hermes/src/agenticos_hermes/workers/github_client.py`:

```python
"""Read-only GitHub REST client for the pr-triage connector.

Discovers open PRs across an org via the Search API, then fetches per-PR
detail (mergeable state), check-runs (CI rollup), and reviews (approval
state). NO write calls — this client never mutates GitHub.
"""
from __future__ import annotations

from typing import Any

import httpx

API_BASE = "https://api.github.com"
_ACCEPT = "application/vnd.github+json"
_API_VERSION = "2022-11-28"


class GitHubClient:
    def __init__(self, token: str, org: str, base_url: str = API_BASE,
                 timeout: float = 30.0) -> None:
        self.token = token
        self.org = org
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": _ACCEPT,
            "X-GitHub-Api-Version": _API_VERSION,
        }

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.get(url, headers=self._headers(), params=params)
            resp.raise_for_status()
            return resp.json()

    def search_open_prs(self) -> list[dict[str, Any]]:
        """All open (non-archived) PRs across the org, via the Search API.

        Returns dicts: repo_full_name, number, title, author, draft,
        updated_at, html_url.
        """
        q = f"org:{self.org} is:pr is:open archived:false"
        body = self._get("/search/issues", params={"q": q, "per_page": 100})
        out: list[dict[str, Any]] = []
        for it in body.get("items", []):
            repo_url = it.get("repository_url", "")
            repo_full = repo_url.split("/repos/", 1)[-1] if repo_url else ""
            out.append(
                {
                    "repo_full_name": repo_full,
                    "number": it["number"],
                    "title": it.get("title", ""),
                    "author": (it.get("user") or {}).get("login", ""),
                    "draft": bool(it.get("draft", False)),
                    "updated_at": it.get("updated_at", ""),
                    "html_url": it.get("html_url", ""),
                }
            )
        return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agenticos-hermes && PYTHONPATH=src .venv/bin/python -m pytest tests/test_pr_triage.py::test_search_open_prs_parses_items -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agenticos-hermes/src/agenticos_hermes/workers/github_client.py packages/agenticos-hermes/tests/test_pr_triage.py
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(hermes): github_client.search_open_prs (org PR discovery via Search API)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: GitHub client — per-PR detail, checks rollup, review state

**Files:**
- Modify: `packages/agenticos-hermes/src/agenticos_hermes/workers/github_client.py`
- Test: `packages/agenticos-hermes/tests/test_pr_triage.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_pr_triage.py`:

```python
def test_rollup_checks():
    assert gh.rollup_checks([]) == "none"
    assert gh.rollup_checks(
        [{"status": "completed", "conclusion": "success"}]
    ) == "success"
    assert gh.rollup_checks(
        [{"status": "completed", "conclusion": "success"},
         {"status": "in_progress", "conclusion": None}]
    ) == "pending"
    assert gh.rollup_checks(
        [{"status": "completed", "conclusion": "success"},
         {"status": "completed", "conclusion": "failure"}]
    ) == "failure"


def test_derive_review_state():
    assert gh.derive_review_state([]) == "none"
    assert gh.derive_review_state(
        [{"user": {"login": "a"}, "state": "APPROVED",
          "submitted_at": "2026-06-01T00:00:00Z"}]
    ) == "approved"
    # latest review per author wins: a approves then requests changes
    assert gh.derive_review_state(
        [{"user": {"login": "a"}, "state": "APPROVED",
          "submitted_at": "2026-06-01T00:00:00Z"},
         {"user": {"login": "a"}, "state": "CHANGES_REQUESTED",
          "submitted_at": "2026-06-02T00:00:00Z"}]
    ) == "changes_requested"
    # COMMENTED reviews are ignored
    assert gh.derive_review_state(
        [{"user": {"login": "a"}, "state": "COMMENTED",
          "submitted_at": "2026-06-01T00:00:00Z"}]
    ) == "none"
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/agenticos-hermes && PYTHONPATH=src .venv/bin/python -m pytest tests/test_pr_triage.py -k "rollup_checks or derive_review_state" -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'rollup_checks'`.

- [ ] **Step 3: Write the implementation**

Append to `github_client.py`:

```python
_BAD_CONCLUSIONS = {"failure", "timed_out", "cancelled", "action_required",
                    "startup_failure", "stale"}


def rollup_checks(check_runs: list[dict[str, Any]]) -> str:
    """Roll up a head SHA's check-runs into success | failure | pending | none."""
    if not check_runs:
        return "none"
    completed = [c for c in check_runs if c.get("status") == "completed"]
    if len(completed) < len(check_runs):
        return "pending"
    if any(c.get("conclusion") in _BAD_CONCLUSIONS for c in completed):
        return "failure"
    return "success"


def derive_review_state(reviews: list[dict[str, Any]]) -> str:
    """Latest decisive review per author → approved | changes_requested | none.

    COMMENTED/PENDING reviews are ignored. Reviews are ordered by
    submitted_at so the most recent decisive state per reviewer wins.
    """
    latest: dict[str, str] = {}
    for r in sorted(reviews, key=lambda x: x.get("submitted_at") or ""):
        state = r.get("state")
        if state in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED"):
            latest[(r.get("user") or {}).get("login", "?")] = state
    states = set(latest.values())
    if "CHANGES_REQUESTED" in states:
        return "changes_requested"
    if "APPROVED" in states:
        return "approved"
    return "none"
```

Also add these methods to `GitHubClient` (after `search_open_prs`):

```python
    def pr_detail(self, repo_full_name: str, number: int) -> dict[str, Any]:
        """Single-PR GET — mergeable_state + head SHA (not in search results)."""
        body = self._get(f"/repos/{repo_full_name}/pulls/{number}")
        return {
            "mergeable_state": body.get("mergeable_state", "unknown"),
            "head_sha": (body.get("head") or {}).get("sha", ""),
        }

    def pr_checks_state(self, repo_full_name: str, head_sha: str) -> str:
        if not head_sha:
            return "none"
        body = self._get(f"/repos/{repo_full_name}/commits/{head_sha}/check-runs")
        return rollup_checks(body.get("check_runs", []))

    def pr_review_state(self, repo_full_name: str, number: int) -> str:
        body = self._get(f"/repos/{repo_full_name}/pulls/{number}/reviews")
        reviews = body if isinstance(body, list) else body.get("reviews", [])
        return derive_review_state(reviews)
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/agenticos-hermes && PYTHONPATH=src .venv/bin/python -m pytest tests/test_pr_triage.py -k "rollup_checks or derive_review_state" -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add packages/agenticos-hermes/src/agenticos_hermes/workers/github_client.py packages/agenticos-hermes/tests/test_pr_triage.py
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(hermes): github_client per-PR detail + checks/review rollups

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Assessment — pure bucket classifier

**Files:**
- Create: `packages/agenticos-hermes/src/agenticos_hermes/tasks/pr_triage.py`
- Test: `packages/agenticos-hermes/tests/test_pr_triage.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_pr_triage.py`:

```python
from agenticos_hermes.tasks import pr_triage as pt

_NOW = datetime(2026, 6, 10, 0, 0, 0, tzinfo=timezone.utc)


def _facts(**over):
    base = {
        "repo_full_name": "o/r", "number": 1, "title": "T", "author": "a",
        "html_url": "u", "draft": False, "updated_at": "2026-06-09T00:00:00Z",
        "mergeable_state": "clean", "checks_state": "success",
        "review_state": "approved",
    }
    base.update(over)
    return base


def test_assess_ready_to_merge():
    assert pt.assess_pr(_facts(), _NOW, stale_days=7) == ["ready-to-merge"]


def test_assess_ci_failing_and_needs_review():
    got = pt.assess_pr(
        _facts(checks_state="failure", review_state="none"), _NOW, stale_days=7
    )
    assert "ci-failing" in got
    assert "needs-review" in got
    assert "ready-to-merge" not in got


def test_assess_conflicts():
    got = pt.assess_pr(_facts(mergeable_state="dirty"), _NOW, stale_days=7)
    assert "has-conflicts" in got


def test_assess_stale_by_updated_at():
    got = pt.assess_pr(
        _facts(updated_at="2026-05-01T00:00:00Z"), _NOW, stale_days=7
    )
    assert "stale" in got


def test_assess_draft_excluded_from_needs_review():
    got = pt.assess_pr(
        _facts(draft=True, review_state="none"), _NOW, stale_days=7
    )
    assert "draft" in got
    assert "needs-review" not in got
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/agenticos-hermes && PYTHONPATH=src .venv/bin/python -m pytest tests/test_pr_triage.py -k assess -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agenticos_hermes.tasks.pr_triage'`.

- [ ] **Step 3: Write the implementation**

Create `packages/agenticos-hermes/src/agenticos_hermes/tasks/pr_triage.py` with the imports, config, and the pure `assess_pr` (the rest is added in later tasks):

```python
"""pr-triage: cron connector that triages open PRs across the GitHub org.

fetch (GitHub REST) -> assess (pure) -> render (markdown + optional SLM intro)
-> write (living vault note) -> record (Postgres tasks row). Read-only on
GitHub. Mirrors the daily_brief cron-task pattern.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..db import connect
from ..workers.github_client import GitHubClient
from ..workers.slm_runner import run_slm

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_ORG = os.environ.get("GITHUB_ORG", "EngineeringMoonBear")
STALE_DAYS = int(os.environ.get("PR_TRIAGE_STALE_DAYS", "7"))
VAULT_NOTE = Path(
    os.environ.get("PR_TRIAGE_VAULT_NOTE",
                   "/opt/vault/wiki/_meta/dev-pr-digest.md")
)
SLM_MODEL = os.environ.get("PR_TRIAGE_SLM_MODEL", "qwen2.5:3b")

# Buckets shown in the "needs attention" section, in priority order.
ATTENTION_BUCKETS = ["ci-failing", "has-conflicts", "needs-review",
                     "ready-to-merge", "stale"]


def assess_pr(facts: dict[str, Any], now: datetime, stale_days: int) -> list[str]:
    """Classify one PR's facts into buckets (deterministic, no I/O)."""
    buckets: list[str] = []
    if facts.get("draft"):
        buckets.append("draft")
    if facts.get("checks_state") == "failure":
        buckets.append("ci-failing")
    if facts.get("mergeable_state") == "dirty":
        buckets.append("has-conflicts")
    if facts.get("review_state") == "none" and not facts.get("draft"):
        buckets.append("needs-review")
    if (facts.get("review_state") == "approved"
            and facts.get("checks_state") == "success"
            and facts.get("mergeable_state") in ("clean", "unstable")):
        buckets.append("ready-to-merge")
    updated = facts.get("updated_at") or ""
    try:
        ts = datetime.fromisoformat(updated.replace("Z", "+00:00"))
        if (now - ts).days >= stale_days:
            buckets.append("stale")
    except ValueError:
        pass
    return buckets
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/agenticos-hermes && PYTHONPATH=src .venv/bin/python -m pytest tests/test_pr_triage.py -k assess -v`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add packages/agenticos-hermes/src/agenticos_hermes/tasks/pr_triage.py packages/agenticos-hermes/tests/test_pr_triage.py
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(hermes): pr_triage.assess_pr pure bucket classifier

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Renderer — deterministic digest markdown

**Files:**
- Modify: `packages/agenticos-hermes/src/agenticos_hermes/tasks/pr_triage.py`
- Test: `packages/agenticos-hermes/tests/test_pr_triage.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_pr_triage.py`:

```python
def test_render_digest_sections_and_counts():
    assessed = [
        {**_facts(number=1, title="Broken", checks_state="failure",
                  review_state="none"), "buckets": ["ci-failing", "needs-review"]},
        {**_facts(number=2, title="Done"), "buckets": ["ready-to-merge"]},
    ]
    md = pt.render_digest(assessed, generated_at=_NOW, intro="Two PRs open.")
    assert "# Dev PR Triage" in md
    assert "Two PRs open." in md
    assert "Needs your attention" in md
    assert "Broken" in md and "Done" in md
    assert "ci-failing" in md
    # a per-repo table row references the repo
    assert "o/r" in md


def test_render_digest_empty():
    md = pt.render_digest([], generated_at=_NOW, intro="No open PRs.")
    assert "No open PRs" in md
    assert "# Dev PR Triage" in md
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/agenticos-hermes && PYTHONPATH=src .venv/bin/python -m pytest tests/test_pr_triage.py -k render_digest -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'render_digest'`.

- [ ] **Step 3: Write the implementation**

Append to `pr_triage.py`:

```python
def _age_days(updated_at: str, now: datetime) -> int:
    try:
        ts = datetime.fromisoformat((updated_at or "").replace("Z", "+00:00"))
        return (now - ts).days
    except ValueError:
        return -1


def render_digest(assessed: list[dict[str, Any]], generated_at: datetime,
                  intro: str) -> str:
    """Render the digest markdown from assessed PRs. Deterministic."""
    lines = [
        "---",
        f"generated_at: {generated_at.isoformat()}",
        "---",
        "",
        f"# Dev PR Triage — {generated_at.date().isoformat()}",
        "",
        intro.strip(),
        "",
    ]

    attention = [
        a for a in assessed
        if any(b in ATTENTION_BUCKETS for b in a.get("buckets", []))
    ]
    lines.append("## 🔔 Needs your attention")
    lines.append("")
    if not attention:
        lines.append("- Nothing flagged. 🎉")
    else:
        def _key(a: dict[str, Any]) -> int:
            for i, b in enumerate(ATTENTION_BUCKETS):
                if b in a.get("buckets", []):
                    return i
            return len(ATTENTION_BUCKETS)
        for a in sorted(attention, key=_key):
            tags = ", ".join(b for b in a["buckets"] if b in ATTENTION_BUCKETS)
            lines.append(
                f"- **[{a['repo_full_name']}#{a['number']}]({a['html_url']})** "
                f"{a['title']} — _{tags}_ (@{a['author']})"
            )
    lines.append("")

    lines.append("## All open PRs")
    lines.append("")
    lines.append("| Repo | PR | Author | Buckets | Age (d) |")
    lines.append("| --- | --- | --- | --- | --- |")
    for a in assessed:
        buckets = ", ".join(a.get("buckets", [])) or "—"
        age = _age_days(a.get("updated_at", ""), generated_at)
        lines.append(
            f"| {a['repo_full_name']} | "
            f"[#{a['number']}]({a['html_url']}) | "
            f"@{a['author']} | {buckets} | {age} |"
        )
    lines.append("")
    return "\n".join(lines)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/agenticos-hermes && PYTHONPATH=src .venv/bin/python -m pytest tests/test_pr_triage.py -k render_digest -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add packages/agenticos-hermes/src/agenticos_hermes/tasks/pr_triage.py packages/agenticos-hermes/tests/test_pr_triage.py
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(hermes): pr_triage.render_digest deterministic markdown

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Recorders + intro helper + orchestrator

**Files:**
- Modify: `packages/agenticos-hermes/src/agenticos_hermes/tasks/pr_triage.py`
- Test: `packages/agenticos-hermes/tests/test_pr_triage.py`

- [ ] **Step 1: Write the failing test** (orchestrator, fully mocked — no DB/network)

Append to `tests/test_pr_triage.py`:

```python
from unittest.mock import patch, MagicMock


@patch("agenticos_hermes.tasks.pr_triage.record_task_completion")
@patch("agenticos_hermes.tasks.pr_triage.record_task_start")
@patch("agenticos_hermes.tasks.pr_triage.write_note")
@patch("agenticos_hermes.tasks.pr_triage.slm_intro", return_value="intro")
@patch("agenticos_hermes.tasks.pr_triage.GitHubClient")
def test_run_pr_triage_happy_path(mock_gh, mock_intro, mock_write,
                                  mock_start, mock_done):
    inst = mock_gh.return_value
    inst.search_open_prs.return_value = [
        {"repo_full_name": "o/r", "number": 7, "title": "T", "author": "a",
         "draft": False, "updated_at": "2026-06-09T00:00:00Z",
         "html_url": "u"}
    ]
    inst.pr_detail.return_value = {"mergeable_state": "clean", "head_sha": "abc"}
    inst.pr_checks_state.return_value = "success"
    inst.pr_review_state.return_value = "approved"

    summary = pt.run_pr_triage(token="t", org="o")

    assert summary["total"] == 1
    assert summary["errored"] == 0
    assert summary["buckets"]["ready-to-merge"] == 1
    mock_write.assert_called_once()
    mock_start.assert_called_once()
    # completion recorded as done
    assert mock_done.call_args.kwargs["status"] == "done"


@patch("agenticos_hermes.tasks.pr_triage.record_task_completion")
@patch("agenticos_hermes.tasks.pr_triage.record_task_start")
def test_run_pr_triage_no_token_fails_loud(mock_start, mock_done):
    summary = pt.run_pr_triage(token="", org="o")
    assert summary["status"] == "failed"
    assert "token" in summary["error"].lower()
    assert mock_done.call_args.kwargs["status"] == "failed"
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/agenticos-hermes && PYTHONPATH=src .venv/bin/python -m pytest tests/test_pr_triage.py -k run_pr_triage -v`
Expected: FAIL — `AttributeError: ... has no attribute 'record_task_start'` (and friends).

- [ ] **Step 3: Write the implementation**

Append to `pr_triage.py`:

```python
# ---------------------------------------------------------------------------
# Postgres recorders (cron-task side of the cost-recorder contract; mirrors
# daily_brief but records bucket counts in metadata on both insert + update).
# ---------------------------------------------------------------------------

def record_task_start(*, task_id: str, kind: str, trigger: str,
                      metadata: dict[str, Any] | None = None) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO tasks (id, kind, trigger, started_at, status, metadata)
               VALUES (%s, %s, %s, now(), 'running', %s::jsonb)""",
            (task_id, kind, trigger, json.dumps(metadata or {})),
        )


def record_task_completion(*, task_id: str, status: str,
                           error: str | None = None,
                           metadata: dict[str, Any] | None = None) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE tasks
               SET status = %s, ended_at = now(), error = %s,
                   metadata = COALESCE(%s::jsonb, metadata)
               WHERE id = %s""",
            (status, error,
             json.dumps(metadata) if metadata is not None else None,
             task_id),
        )


def write_note(content: str, path: Path = VAULT_NOTE) -> Path:
    """Overwrite the living digest note, world-readable so the container reads it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(0o644)
    return path


def slm_intro(counts: dict[str, int], total: int) -> str:
    """Short prose intro from the local SLM. Degrades to deterministic on error."""
    fallback = (
        f"{total} open PR(s): " + ", ".join(f"{k} {v}" for k, v in counts.items())
        if counts else f"{total} open PR(s); nothing flagged."
    )
    try:
        result = run_slm(
            model=SLM_MODEL,
            system="You write one terse sentence. No preamble, no markdown.",
            prompt=(
                "Summarize this PR triage in ONE sentence for a developer's "
                f"morning. Total open PRs: {total}. Bucket counts: {counts}."
            ),
        )
        text = result.text.strip().splitlines()[0].strip() if result.text else ""
        return text or fallback
    except Exception:
        return fallback


def _collect_facts(client: GitHubClient, pr: dict[str, Any]) -> dict[str, Any]:
    repo = pr["repo_full_name"]
    detail = client.pr_detail(repo, pr["number"])
    checks = client.pr_checks_state(repo, detail["head_sha"])
    review = client.pr_review_state(repo, pr["number"])
    return {**pr, "mergeable_state": detail["mergeable_state"],
            "checks_state": checks, "review_state": review}


def run_pr_triage(token: str = GITHUB_TOKEN, org: str = GITHUB_ORG) -> dict[str, Any]:
    """Entry point. Returns a summary dict; also records to Postgres + vault."""
    now = datetime.now(timezone.utc)
    task_id = f"pr-triage-{now.date().isoformat()}-{uuid.uuid4().hex[:6]}"
    record_task_start(task_id=task_id, kind="pr-triage",
                      trigger="cron:pr-triage", metadata={})

    if not token:
        err = "GITHUB_TOKEN not set; cannot reach GitHub"
        record_task_completion(task_id=task_id, status="failed", error=err)
        return {"status": "failed", "error": err, "total": 0, "errored": 0,
                "buckets": {}}

    client = GitHubClient(token=token, org=org)
    assessed: list[dict[str, Any]] = []
    errors: list[str] = []
    try:
        prs = client.search_open_prs()
    except Exception as exc:
        err = f"search_open_prs failed: {exc}"
        record_task_completion(task_id=task_id, status="failed", error=err)
        return {"status": "failed", "error": err, "total": 0, "errored": 0,
                "buckets": {}}

    for pr in prs:
        try:
            facts = _collect_facts(client, pr)
            facts["buckets"] = assess_pr(facts, now, STALE_DAYS)
            assessed.append(facts)
        except Exception as exc:  # per-PR isolation: don't abort the run
            errors.append(f"{pr.get('repo_full_name')}#{pr.get('number')}: {exc}")

    counts: dict[str, int] = {}
    for a in assessed:
        for b in a["buckets"]:
            counts[b] = counts.get(b, 0) + 1

    intro = slm_intro(counts, len(assessed))
    digest = render_digest(assessed, generated_at=now, intro=intro)
    if errors:
        digest += "\n## ⚠️ Errors\n\n" + "\n".join(f"- {e}" for e in errors) + "\n"
    write_note(digest)

    summary = {
        "status": "done",
        "total": len(assessed),
        "errored": len(errors),
        "buckets": counts,
        "errors": errors,
    }
    record_task_completion(task_id=task_id, status="done", metadata=summary)
    return summary


if __name__ == "__main__":
    print(json.dumps(run_pr_triage()))
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/agenticos-hermes && PYTHONPATH=src .venv/bin/python -m pytest tests/test_pr_triage.py -v`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add packages/agenticos-hermes/src/agenticos_hermes/tasks/pr_triage.py packages/agenticos-hermes/tests/test_pr_triage.py
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(hermes): pr_triage orchestrator (fetch/assess/render/write/record)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Cron wrapper + registration

**Files:**
- Create: `packages/agenticos-hermes/wrappers/cron-scripts/pr-triage.sh`
- Modify: `infra/scripts/register-cron-jobs.sh`

- [ ] **Step 1: Create the wrapper script**

Create `packages/agenticos-hermes/wrappers/cron-scripts/pr-triage.sh`:

```bash
#!/bin/bash
# Hermes cron wrapper for the pr-triage connector.
#
# Invoked by `hermes cron` with --no-agent — this script IS the job. The
# Python task writes the digest to /opt/vault/wiki/_meta/dev-pr-digest.md
# and records its own tasks-ledger row; cron stdout is for logs only.
#
# Hermes resolves --script paths under $HERMES_HOME/scripts/ — for our
# gateway container that's /opt/data/scripts/, bind-mounted from this dir.
set -euo pipefail
exec /opt/hermes/.venv/bin/python -m agenticos_hermes.tasks.pr_triage
```

- [ ] **Step 2: Make it executable + register the job**

```bash
chmod +x packages/agenticos-hermes/wrappers/cron-scripts/pr-triage.sh
```

In `infra/scripts/register-cron-jobs.sh`, add this line directly below the `vault-ingest` registration:

```bash
register pr-triage    "30 7 * * *" pr-triage.sh
```

- [ ] **Step 3: Verify the registration block**

Run: `grep -n "register " infra/scripts/register-cron-jobs.sh`
Expected: four `register` lines — `daily-brief`, `cost-report`, `vault-ingest`, `pr-triage`.

- [ ] **Step 4: Commit**

```bash
git add packages/agenticos-hermes/wrappers/cron-scripts/pr-triage.sh infra/scripts/register-cron-jobs.sh
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(infra): register pr-triage cron (07:30 daily) + wrapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Compose env wiring (GITHUB_TOKEN + GITHUB_ORG)

**Files:**
- Modify: `docker-compose.yml` (both `hermes-agent` and `hermes-gateway` `environment:` blocks)

- [ ] **Step 1: Add env to `hermes-agent`**

In `docker-compose.yml`, under the `hermes-agent:` service `environment:` block (next to the `OPENVIKING_*` lines), add:

```yaml
      GITHUB_TOKEN: ${GITHUB_TOKEN:-}
      GITHUB_ORG: ${GITHUB_ORG:-EngineeringMoonBear}
```

- [ ] **Step 2: Add the same env to `hermes-gateway`**

In the `hermes-gateway:` service `environment:` block (the gateway is what runs the cron), add the identical two lines:

```yaml
      GITHUB_TOKEN: ${GITHUB_TOKEN:-}
      GITHUB_ORG: ${GITHUB_ORG:-EngineeringMoonBear}
```

- [ ] **Step 3: Validate compose syntax**

Run: `docker compose -f docker-compose.yml config >/dev/null && echo "compose OK"`
Expected: `compose OK` (no YAML/interpolation errors). If `docker` is unavailable locally, instead run `python -c "import yaml,sys; yaml.safe_load(open('docker-compose.yml'))" && echo "yaml OK"`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(infra): inject GITHUB_TOKEN + GITHUB_ORG into hermes containers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Deploy doc — token provisioning + rollout steps

**Files:**
- Modify: `docs/runbooks/deploy-hermes-code.md`

- [ ] **Step 1: Append a connector section**

Add to the end of `docs/runbooks/deploy-hermes-code.md`:

````markdown
## Deploying the pr-triage connector

One-time, on the Droplet (Josh provisions the token — the assistant does not
create credentials):

1. Create a **fine-grained GitHub PAT** (read-only): Contents, Pull requests,
   Checks, Metadata — all *Read*. Scope it to the `EngineeringMoonBear` org.
2. Add it to `/opt/agenticos/.env`:

   ```bash
   echo "GITHUB_TOKEN=<the-token>" >> /opt/agenticos/.env
   echo "GITHUB_ORG=EngineeringMoonBear" >> /opt/agenticos/.env
   ```

3. Rebuild + restart hermes (see the procedure above — git pull in
   `/opt/agenticos/repo`, ensure the `packages` symlink, rebuild, `up -d`).
4. Register the new cron job (idempotent):

   ```bash
   docker cp /opt/agenticos/repo/infra/scripts/register-cron-jobs.sh \
     hermes-agent:/tmp/register-cron-jobs.sh
   docker exec hermes-agent /tmp/register-cron-jobs.sh
   ```

5. Trigger one run now (don't wait for 07:30) and verify:

   ```bash
   docker exec hermes-gateway /opt/hermes/.venv/bin/python -m agenticos_hermes.tasks.pr_triage
   cat /opt/vault/wiki/_meta/dev-pr-digest.md | head -30
   ```

   Expected: JSON summary with `"status": "done"`, and the digest note lists
   real open PRs across the org.
````

- [ ] **Step 2: Lint the doc**

Run: `npx markdownlint-cli2 docs/runbooks/deploy-hermes-code.md`
Expected: `0 error(s)`.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/deploy-hermes-code.md
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "docs(runbook): pr-triage connector token provisioning + rollout

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] Run the full hermes test suite:

  Run: `cd packages/agenticos-hermes && PYTHONPATH=src .venv/bin/python -m pytest tests/test_pr_triage.py -v`
  Expected: all PASS.

- [ ] Confirm no placeholder/stub remains: `grep -rn "TODO\|FIXME\|NotImplemented" packages/agenticos-hermes/src/agenticos_hermes/tasks/pr_triage.py packages/agenticos-hermes/src/agenticos_hermes/workers/github_client.py` → no output.

- [ ] Open the PR; CI green (Pytest, Lint, markdownlint, actionlint).

- [ ] Deploy per Task 8 on the Droplet; verify the digest note + `pr-triage` task row; confirm `soak-healthcheck.sh` still passes and the next `vault-ingest` ingests the digest note.

---

## Notes / known simplifications (intentional, per spec YAGNI)

- **Review state** is derived from the reviews list (latest decisive review per
  author), not GitHub's GraphQL `reviewDecision`. Good enough for triage.
- **`mergeable_state`** may be `unknown` immediately after a push (GitHub computes
  it async); a PR briefly shows no `has-conflicts`/`ready-to-merge` until the
  next run. Acceptable for a daily digest.
- **Read-only**: no labels/comments/merges. Write capability is a separate,
  explicitly-gated follow-up.
