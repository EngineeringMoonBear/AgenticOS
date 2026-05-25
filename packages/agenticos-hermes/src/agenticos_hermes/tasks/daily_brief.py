"""daily-brief: cron task that compiles a morning summary.

Fires at 07:00 America/New_York via Hermes config.yaml cron section (wired
up in Task 26). Uses Codex (gpt-5-codex) because synthesis across vault
memory + recent task history needs reasoning.

Module layout note (diverges from the plan's verbatim text):

The plan references `..skills.cost_recorder` for the `record_*` helpers,
but per `docs/superpowers/specs/spec1-verified-api-shapes.md` the cost
recorder is a Hermes hook plugin, not an importable module. The cron-task
side of the contract (task_start / session_start / call / session_end /
task_completion writes) is implemented here as small `record_*` helpers
that write directly to Postgres via `agenticos_hermes.db.connect()`.

The hook plugin (`plugins/cost-recorder/__init__.py`) handles the
post_llm_call + on_session_end side from inside the Hermes container.
For cron tasks that drive Codex/SLM calls themselves (no Hermes session),
we record the call inline here.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import date
from pathlib import Path
from typing import Any

import httpx

from ..db import connect
from ..workers.codex_coder import run_codex

VAULT_ROOT = Path(os.environ.get("VAULT_ROOT", "/opt/vault"))
OPENVIKING_ENDPOINT = os.environ.get(
    "OPENVIKING_ENDPOINT", "http://127.0.0.1:1933"
)
OPENVIKING_ROOT_API_KEY = os.environ.get("OPENVIKING_ROOT_API_KEY", "")


# ---------------------------------------------------------------------------
# DB recorder helpers (cron-task side of the cost-recorder contract).
# These are defined here so tests can patch them at
# `agenticos_hermes.tasks.daily_brief.record_*`.
# ---------------------------------------------------------------------------

def record_task_start(
    *,
    task_id: str,
    kind: str,
    trigger: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Insert a `tasks` row marking the start of a cron task."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO tasks (id, kind, trigger, started_at, status, metadata)
               VALUES (%s, %s, %s, now(), 'running', %s::jsonb)""",
            (task_id, kind, trigger, json.dumps(metadata or {})),
        )


def record_session_start(
    *,
    session_id: str,
    task_id: str,
    hermes_skill: str,
) -> None:
    """Insert a `sessions` row linking a Hermes session to its parent task."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO sessions (id, task_id, hermes_skill, started_at)
               VALUES (%s, %s, %s, now())""",
            (session_id, task_id, hermes_skill),
        )


def record_call(
    *,
    session_id: str,
    task_id: str,
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    latency_ms: int,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Insert a `calls` row for an LLM invocation driven by this task.

    Cron tasks (unlike Hermes-skill calls) don't fire `post_llm_call`, so
    we record the call inline rather than relying on the hook plugin.
    Cost is left at 0 here; the session-end roll-up in the cost-recorder
    plugin recomputes per-task cost from `calls.cost_cents`. For Codex
    calls specifically, pricing lookup can be added once tariff data lands.
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO calls
               (session_id, task_id, provider, model,
                input_tokens, output_tokens,
                cost_cents, latency_ms, metadata)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)""",
            (
                session_id,
                task_id,
                provider,
                model,
                input_tokens,
                output_tokens,
                0,
                latency_ms,
                json.dumps(metadata or {}),
            ),
        )


def record_session_end(*, session_id: str) -> None:
    """Close a `sessions` row by stamping `ended_at`."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE sessions SET ended_at = now() WHERE id = %s",
            (session_id,),
        )


def record_task_completion(
    *,
    task_id: str,
    status: str,
    error: str | None = None,
) -> None:
    """Mark a `tasks` row complete with terminal status (done | failed)."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE tasks
               SET status = %s, ended_at = now(), error = %s
               WHERE id = %s""",
            (status, error, task_id),
        )


# ---------------------------------------------------------------------------
# External integrations.
# ---------------------------------------------------------------------------

def openviking_search(query: str, top_k: int = 20) -> list[dict[str, Any]]:
    """Query OpenViking's verified semantic-search endpoint.

    Spec1 verified API shape: POST /api/v1/search/find with Bearer auth.
    See docs/superpowers/specs/spec1-verified-api-shapes.md §4.
    """
    headers = {}
    if OPENVIKING_ROOT_API_KEY:
        headers["Authorization"] = f"Bearer {OPENVIKING_ROOT_API_KEY}"
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{OPENVIKING_ENDPOINT}/api/v1/search/find",
            json={"query": query, "top_k": top_k},
            headers=headers,
        )
        resp.raise_for_status()
        body = resp.json()
        # Endpoint returns either {"results": [...]} or a bare list — handle both
        if isinstance(body, list):
            return body
        return body.get("results", [])


def fetch_yesterday_task_summary() -> list[tuple[str, int, int]]:
    """Pull yesterday's task tallies grouped by kind from the telemetry DB."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT t.kind, COUNT(*)::int, COALESCE(SUM(t.cost_cents), 0)::int
               FROM tasks t
               WHERE t.started_at::date = current_date - 1
               GROUP BY t.kind
               ORDER BY 2 DESC"""
        )
        return list(cur.fetchall())


def write_brief_file(content: str, day: date) -> Path:
    """Write the brief Markdown to /opt/vault/daily-briefs/YYYY-MM-DD.md."""
    out_dir = VAULT_ROOT / "daily-briefs"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{day.isoformat()}.md"
    out_path.write_text(content, encoding="utf-8")
    return out_path


# ---------------------------------------------------------------------------
# Entrypoint.
# ---------------------------------------------------------------------------

def run_daily_brief() -> str:
    """Compile and write today's daily brief. Returns the task_id used."""
    today = date.today()
    task_id = f"daily-brief-{today.isoformat()}-{uuid.uuid4().hex[:6]}"
    session_id = f"{task_id}-s1"

    record_task_start(
        task_id=task_id,
        kind="daily-brief",
        trigger="cron:daily-brief",
        metadata={"day": today.isoformat()},
    )
    record_session_start(
        session_id=session_id,
        task_id=task_id,
        hermes_skill="codex-coder",
    )

    try:
        memories = openviking_search(
            "events, notes, or reminders from the last 24 hours",
            top_k=20,
        )
        memory_text = "\n".join(
            f"- {m.get('text', '')[:200]}" for m in memories
        ) or "- (no recent memories)"

        try:
            yesterday = fetch_yesterday_task_summary()
        except Exception:
            # Yesterday's roll-up isn't critical — the brief still ships.
            yesterday = []
        yesterday_text = (
            "\n".join(f"- {kind}: {n} runs, ${cents/100:.2f}"
                      for kind, n, cents in yesterday)
            or "- (no tasks yesterday)"
        )

        prompt = f"""Compose a concise morning brief in Markdown.
Date: {today.isoformat()}

Recent context from the vault:
{memory_text}

Yesterday's task tallies (from telemetry DB):
{yesterday_text}

Format:
# Daily Brief — {today.isoformat()}
## What happened yesterday
## What's due today
## Open threads worth noting
"""

        result = run_codex(prompt=prompt, task_id=task_id)
        record_call(
            session_id=session_id,
            task_id=task_id,
            provider="openai",
            model=result.model,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            latency_ms=result.latency_ms,
            metadata={"task": "daily-brief"},
        )

        write_brief_file(result.text, today)
        record_session_end(session_id=session_id)
        record_task_completion(task_id=task_id, status="done")
    except Exception as exc:
        record_session_end(session_id=session_id)
        record_task_completion(
            task_id=task_id, status="failed", error=str(exc)[:500]
        )
        raise

    return task_id
