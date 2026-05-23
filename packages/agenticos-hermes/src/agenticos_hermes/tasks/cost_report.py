"""cost-report: cron task that rolls up daily spend.

SLM-only (Qwen 2.5 3B) — pure formatting/summarization, doesn't need Codex.
Adds an alert section if month-to-date crosses the soft-alert threshold.

Module layout note (diverges from the plan's verbatim text):

The plan references `..skills.cost_recorder` for the `record_*` helpers,
but per `docs/superpowers/specs/spec1-verified-api-shapes.md` the cost
recorder is a Hermes hook plugin, not an importable module. The cron-task
side of the contract (task_start / session_start / call / session_end /
task_completion writes) is implemented here as small `record_*` helpers
that write directly to Postgres via `agenticos_hermes.db.connect()`,
mirroring the pattern established by `tasks/daily_brief.py`.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import date
from pathlib import Path
from typing import Any

from ..db import connect
from ..workers.slm_runner import run_slm

VAULT_ROOT = Path(os.environ.get("VAULT_ROOT", "/opt/vault"))


# ---------------------------------------------------------------------------
# DB recorder helpers (cron-task side of the cost-recorder contract).
# Defined here so tests can patch them at
# `agenticos_hermes.tasks.cost_report.record_*`.
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

    Cost is 0 for Ollama (local SLM). The cost-recorder plugin's
    session-end roll-up will recompute per-task cost from `calls.cost_cents`.
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
               SET status = %s, completed_at = now(), error = %s
               WHERE id = %s""",
            (status, error, task_id),
        )


# ---------------------------------------------------------------------------
# Report I/O + stats gathering.
# ---------------------------------------------------------------------------

def write_report_file(content: str, day: date) -> Path:
    """Write the cost report Markdown to /opt/vault/cost-reports/YYYY-MM-DD.md."""
    out_dir = VAULT_ROOT / "cost-reports"
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / f"{day.isoformat()}.md"
    p.write_text(content, encoding="utf-8")
    return p


def _gather_stats() -> dict[str, Any]:
    """Query the telemetry DB for today's spend rollup and budget status."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT t.kind, COUNT(*)::int, COALESCE(SUM(t.cost_cents), 0)::int
               FROM tasks t
               WHERE t.started_at::date = current_date
               GROUP BY t.kind
               ORDER BY 3 DESC"""
        )
        by_kind = cur.fetchall()

        cur.execute(
            """WITH b AS (SELECT monthly_cap_cents, soft_alert_pct FROM budget WHERE id=1)
               SELECT
                 (SELECT COUNT(*)::int FROM tasks WHERE started_at::date = current_date),
                 (SELECT COALESCE(SUM(cost_cents),0)::int FROM tasks
                    WHERE started_at::date = current_date),
                 b.monthly_cap_cents,
                 b.soft_alert_pct
               FROM b"""
        )
        n_tasks, today_cents, cap, soft_pct = cur.fetchone()

        cur.execute(
            """SELECT COALESCE(SUM(cost_cents),0)::int FROM calls
               WHERE occurred_at >= date_trunc('month', now())"""
        )
        mtd = cur.fetchone()[0]

    return {
        "by_kind": by_kind,
        "n_tasks": n_tasks,
        "today_cents": today_cents,
        "mtd_cents": mtd,
        "cap_cents": cap,
        "soft_alert_cents": cap * soft_pct // 100,
    }


# ---------------------------------------------------------------------------
# Entrypoint.
# ---------------------------------------------------------------------------

def run_cost_report() -> str:
    """Compile and write today's cost report. Returns the task_id used."""
    today = date.today()
    task_id = f"cost-report-{today.isoformat()}-{uuid.uuid4().hex[:6]}"
    session_id = f"{task_id}-s1"

    record_task_start(
        task_id=task_id,
        kind="cost-report",
        trigger="cron:cost-report",
    )
    record_session_start(
        session_id=session_id,
        task_id=task_id,
        hermes_skill="slm-runner",
    )

    try:
        stats = _gather_stats()

        # SLM just formats; it does not invent numbers.
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
            session_id=session_id,
            task_id=task_id,
            provider="ollama",
            model=result.model,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            latency_ms=result.latency_ms,
            metadata={"task": "cost-report"},
        )

        content = result.text
        if stats["mtd_cents"] >= stats["soft_alert_cents"]:
            content = (
                f"> ⚠️ Over soft alert "
                f"(${stats['mtd_cents']/100:.2f} of "
                f"${stats['cap_cents']/100:.2f} cap)\n\n"
            ) + content

        write_report_file(content, today)
        record_session_end(session_id=session_id)
        record_task_completion(task_id=task_id, status="done")
    except Exception as exc:
        record_session_end(session_id=session_id)
        record_task_completion(
            task_id=task_id, status="failed", error=str(exc)[:500]
        )
        raise

    return task_id
