"""cost-recorder hook plugin for Hermes Agent.

Records every LLM API call into the agenticos Postgres DB and rolls cost
up to the parent task at session end.

Hook signatures verified 2026-05-22 against Hermes 0.14 bundled plugins
(`/opt/hermes/plugins/observability/langfuse/__init__.py` and
`/opt/hermes/plugins/disk-cleanup/__init__.py`):

  - post_llm_call:  module-level, keyword-only args; usage is a dict with
                    keys input_tokens / output_tokens (or completion_tokens)
                    / cache_read_tokens / cache_write_tokens /
                    reasoning_tokens.
  - on_session_end: module-level, mixed args; we only need session_id.

Hermes 0.14 dispatches hooks via the `register(ctx)` entry point —
function names here are arbitrary, the hook *names* passed to
`ctx.register_hook` are the contract.

Spec 1 session→task linkage: when a cron task starts a Hermes session,
the orchestrator inserts the (task_id, session_id, hermes_skill) row in
`sessions` first. By the time post_llm_call fires, the row already exists.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from agenticos_hermes.db import connect
from agenticos_hermes.pricing import cost_cents

logger = logging.getLogger(__name__)


def _task_id_for_session(session_id: str) -> str | None:
    """Look up the parent task_id for a Hermes session."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT task_id FROM sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
        return row[0] if row else None


def _extract_usage(usage: Any, response: Any) -> dict[str, int]:
    """Normalize Hermes 0.14 usage shapes to the pricing.cost_cents contract.

    Hermes hands us a `usage` dict (post_api_request path) with keys:
        input_tokens, output_tokens|completion_tokens,
        cache_read_tokens, cache_write_tokens, reasoning_tokens

    Older post_llm_call path may pass a `response` object instead; we look
    for `.usage` on it as a fallback. Missing fields default to 0.
    """
    src: dict[str, Any] = {}
    if isinstance(usage, dict):
        src = usage
    elif response is not None:
        # response.usage may be an attr-style object or a dict
        u = getattr(response, "usage", None)
        if isinstance(u, dict):
            src = u
        elif u is not None:
            src = {
                "input_tokens": getattr(u, "input_tokens", 0),
                "output_tokens": getattr(u, "output_tokens", 0)
                                or getattr(u, "completion_tokens", 0),
                "cache_read_tokens": getattr(u, "cache_read_tokens", 0),
                "cache_write_tokens": getattr(u, "cache_write_tokens", 0),
                "reasoning_tokens": getattr(u, "reasoning_tokens", 0),
            }

    return {
        "input_tokens": int(src.get("input_tokens", 0) or 0),
        "cached_input_tokens": int(src.get("cache_read_tokens", 0) or 0),
        "output_tokens": int(
            src.get("output_tokens", src.get("completion_tokens", 0)) or 0
        ),
        "reasoning_output_tokens": int(src.get("reasoning_tokens", 0) or 0),
    }


def post_llm_call(
    *,
    session_id: str = "",
    task_id: str = "",
    provider: str = "openai",
    model: str = "unknown",
    response: Any = None,
    usage: Any = None,
    api_duration: float = 0.0,
    **_: Any,
) -> None:
    """Record a single LLM API call into `calls`.

    Signature verified against Hermes 0.14 langfuse plugin (`on_post_llm_call`,
    `/opt/hermes/plugins/observability/langfuse/__init__.py:801`). We accept
    the subset of kwargs we use and swallow the rest via `**_`.
    """
    if not session_id:
        logger.warning("post_llm_call: empty session_id; skipping")
        return

    parent_task_id = _task_id_for_session(session_id)
    if parent_task_id is None:
        logger.warning(
            "post_llm_call: session %s has no task row; skipping", session_id
        )
        return

    tokens = _extract_usage(usage, response)

    try:
        cost = cost_cents(
            provider=provider,
            model=model,
            input_tokens=tokens["input_tokens"],
            cached_input_tokens=tokens["cached_input_tokens"],
            output_tokens=tokens["output_tokens"],
            reasoning_output_tokens=tokens["reasoning_output_tokens"],
        )
    except ValueError as exc:
        # Unknown model/provider — log and record with cost=0 rather than
        # crash the LLM hook chain.
        logger.warning("post_llm_call: pricing error (%s); recording cost=0", exc)
        cost = 0

    latency_ms = int((api_duration or 0.0) * 1000)

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO calls
               (session_id, task_id, provider, model,
                input_tokens, cached_input_tokens,
                output_tokens, reasoning_output_tokens,
                cost_cents, latency_ms, metadata)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)""",
            (
                session_id,
                parent_task_id,
                provider,
                model,
                tokens["input_tokens"],
                tokens["cached_input_tokens"],
                tokens["output_tokens"],
                tokens["reasoning_output_tokens"],
                cost,
                latency_ms,
                json.dumps({}),
            ),
        )


def on_session_end(
    session_id: str = "",
    completed: bool = True,
    interrupted: bool = False,
    **_: Any,
) -> None:
    """Close the sessions row, then roll up task cost from its calls.

    Signature verified against Hermes 0.14 disk-cleanup plugin
    (`/opt/hermes/plugins/disk-cleanup/__init__.py:_on_session_end`).
    """
    if not session_id:
        return

    with connect() as conn, conn.cursor() as cur:
        # Close session: set ended_at, roll up its calls' cost
        cur.execute(
            "SELECT COALESCE(SUM(cost_cents), 0) FROM calls WHERE session_id = %s",
            (session_id,),
        )
        row = cur.fetchone()
        session_cost = row[0] if row else 0
        cur.execute(
            "UPDATE sessions SET ended_at = now(), cost_cents = %s WHERE id = %s",
            (session_cost, session_id),
        )

        # Also roll up to the task: sum cost across all its sessions' calls.
        cur.execute(
            """UPDATE tasks t SET cost_cents = (
                 SELECT COALESCE(SUM(cost_cents), 0) FROM calls
                 WHERE task_id = t.id
               )
               WHERE id = (SELECT task_id FROM sessions WHERE id = %s)""",
            (session_id,),
        )


def register(ctx) -> None:
    """Hermes 0.14 plugin entry point.

    Registers `post_llm_call` and `on_session_end` hooks. See plugin.yaml
    for the hook-name contract.
    """
    ctx.register_hook("post_llm_call", post_llm_call)
    ctx.register_hook("on_session_end", on_session_end)
