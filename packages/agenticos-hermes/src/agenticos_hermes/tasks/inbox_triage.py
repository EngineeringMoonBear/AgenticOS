"""inbox-triage: classify + relocate + summarize an inbox note.

Invoked by the inbox-watcher daemon (see `daemons/inbox-watcher/watcher.py`)
via subprocess: ``python -m agenticos_hermes.tasks.inbox_triage <path>``
when a stable .md file appears in /opt/vault/inbox.

SLM-only (Qwen 2.5 3B) — pure classification/summarization, no Codex.

Module layout note (diverges from the plan's verbatim text):

The plan references `..skills.slm_runner` / `..skills.cost_recorder` but per
`docs/superpowers/specs/spec1-verified-api-shapes.md` the slm runner lives
under `..workers.slm_runner` and the cost recorder is a Hermes hook plugin,
not an importable module. The cron/task side of the recorder contract
(task_start / session_start / call / session_end / task_completion writes)
is implemented here as small `record_*` helpers that write directly to
Postgres via `agenticos_hermes.db.connect()`, mirroring the pattern
established by `tasks/daily_brief.py` and `tasks/cost_report.py`.
"""
from __future__ import annotations

import json
import os
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from ..db import connect
from ..workers.slm_runner import run_slm

VAULT_ROOT = Path(os.environ.get("VAULT_ROOT", "/opt/vault"))
TRIAGE_MODEL = os.environ.get("TRIAGE_MODEL", "qwen2.5:3b")


# ---------------------------------------------------------------------------
# DB recorder helpers (task side of the cost-recorder contract).
# Defined here so tests can patch them at
# `agenticos_hermes.tasks.inbox_triage.record_*`.
# ---------------------------------------------------------------------------

def record_task_start(
    *,
    task_id: str,
    kind: str,
    trigger: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Insert a `tasks` row marking the start of a task."""
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
# Triage prompt + JSON extraction.
# ---------------------------------------------------------------------------

_TRIAGE_PROMPT = """You triage Obsidian notes into a vault.

Read the note below and respond with ONLY a JSON object — no prose, no
markdown fences — with these keys:
  category: one of "farming", "marketing", "research", "admin", "personal"
  subfolder: a short kebab-case slug (max 20 chars)
  summary: a 1-2 sentence summary

NOTE CONTENTS (truncated to 4000 chars):
---
{content}
---

JSON only:"""


def _safe_json_extract(text: str) -> dict | None:
    """SLMs sometimes wrap JSON in ```json fences; extract the first object.

    Walks the string and returns the first balanced `{...}` block parsed
    as JSON, or ``None`` if no parseable object is found.
    """
    start = text.find("{")
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
        start = text.find("{", start + 1)
    return None


def _sanitize_slug(value: str, *, max_len: int = 20) -> str:
    """Lowercase + strip to [a-z0-9-]+, truncate to max_len."""
    return re.sub(r"[^a-z0-9-]", "", value.lower())[:max_len]


# ---------------------------------------------------------------------------
# Entrypoint.
# ---------------------------------------------------------------------------

def triage_file(path: Path) -> str:
    """Classify, move, and summarize a single inbox note. Returns task_id."""
    task_id = (
        f"inbox-triage-{datetime.now().strftime('%Y-%m-%d-%H-%M-%S')}-"
        f"{uuid.uuid4().hex[:4]}"
    )
    session_id = f"{task_id}-s1"

    record_task_start(
        task_id=task_id,
        kind="inbox-triage",
        trigger=f"fsnotify:{path}",
        metadata={"file": str(path)},
    )
    record_session_start(
        session_id=session_id,
        task_id=task_id,
        hermes_skill="slm-runner",
    )

    try:
        content = path.read_text(encoding="utf-8", errors="replace")[:4000]
        prompt = _TRIAGE_PROMPT.format(content=content)
        result = run_slm(model=TRIAGE_MODEL, prompt=prompt, temperature=0.0)

        record_call(
            session_id=session_id,
            task_id=task_id,
            provider="ollama",
            model=result.model,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            latency_ms=result.latency_ms,
            metadata={"task": "inbox-triage"},
        )

        parsed = _safe_json_extract(result.text)
        if not parsed or "category" not in parsed:
            raise ValueError(
                f"SLM returned unparseable JSON: {result.text[:200]}"
            )

        category = _sanitize_slug(parsed["category"]) or "misc"
        subfolder = _sanitize_slug(parsed.get("subfolder", "misc")) or "misc"
        summary = (parsed.get("summary") or "").strip()

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
    except Exception as exc:
        record_session_end(session_id=session_id)
        record_task_completion(
            task_id=task_id, status="failed", error=str(exc)[:500]
        )
        raise

    return task_id


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(
            "usage: python -m agenticos_hermes.tasks.inbox_triage <path>",
            file=sys.stderr,
        )
        sys.exit(2)
    triage_file(Path(sys.argv[1]))
