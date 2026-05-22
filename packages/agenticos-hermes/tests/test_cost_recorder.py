"""Tests for the cost-recorder Hermes hook plugin.

The plugin lives at `packages/agenticos-hermes/plugins/cost-recorder/`
(hyphenated dir name to match Hermes plugin-naming convention). We load
it via `importlib.util.spec_from_file_location` because `cost-recorder`
isn't a valid Python import name.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

PLUGINS_DIR = Path(__file__).parent.parent / "plugins" / "cost-recorder"
_spec = importlib.util.spec_from_file_location(
    "cost_recorder", str(PLUGINS_DIR / "__init__.py")
)
assert _spec is not None and _spec.loader is not None
cost_recorder = importlib.util.module_from_spec(_spec)
sys.modules["cost_recorder"] = cost_recorder
_spec.loader.exec_module(cost_recorder)


def _make_mock_conn(fetchone_value):
    """Build a MagicMock chain matching `with connect() as conn, conn.cursor() as cur:`."""
    cursor = MagicMock()
    cursor.fetchone.return_value = fetchone_value
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    cm = MagicMock()
    cm.__enter__.return_value = conn
    cm.__exit__.return_value = False
    return cm, cursor


@patch.object(cost_recorder, "connect")
def test_post_llm_call_inserts_row(mock_connect):
    cm, cursor = _make_mock_conn(("task-abc",))
    mock_connect.return_value = cm

    cost_recorder.post_llm_call(
        session_id="sess-1",
        task_id="task-abc",
        provider="openai",
        model="gpt-5-codex",
        usage={
            "input_tokens": 11754,
            "cache_read_tokens": 10624,
            "output_tokens": 6,
            "reasoning_tokens": 0,
        },
        api_duration=1.5,
    )

    calls = [str(c) for c in cursor.execute.call_args_list]
    assert any("SELECT task_id FROM sessions" in c for c in calls), \
        "expected task_id lookup"
    assert any("INSERT INTO calls" in c for c in calls), \
        "expected INSERT into calls"


@patch.object(cost_recorder, "connect")
def test_post_llm_call_skips_when_no_task(mock_connect):
    """If sessions table has no row for this session_id, skip the insert."""
    cm, cursor = _make_mock_conn(None)
    mock_connect.return_value = cm

    cost_recorder.post_llm_call(
        session_id="orphan",
        provider="openai",
        model="gpt-5-codex",
        usage={"input_tokens": 100, "output_tokens": 10},
    )

    calls = [str(c) for c in cursor.execute.call_args_list]
    assert not any("INSERT INTO calls" in c for c in calls), \
        "should not insert when session has no parent task"


@patch.object(cost_recorder, "connect")
def test_post_llm_call_unknown_model_records_zero_cost(mock_connect):
    """Unknown model shouldn't crash the hook chain — record cost=0."""
    cm, cursor = _make_mock_conn(("task-xyz",))
    mock_connect.return_value = cm

    cost_recorder.post_llm_call(
        session_id="sess-2",
        provider="openai",
        model="some-future-model",
        usage={"input_tokens": 50, "output_tokens": 5},
    )
    calls = [str(c) for c in cursor.execute.call_args_list]
    assert any("INSERT INTO calls" in c for c in calls)


@patch.object(cost_recorder, "connect")
def test_post_llm_call_local_provider_zero_cost(mock_connect):
    cm, cursor = _make_mock_conn(("task-ollama",))
    mock_connect.return_value = cm

    cost_recorder.post_llm_call(
        session_id="sess-3",
        provider="ollama",
        model="qwen2.5:3b",
        usage={"input_tokens": 200, "output_tokens": 50},
    )
    calls = [str(c) for c in cursor.execute.call_args_list]
    assert any("INSERT INTO calls" in c for c in calls)


@patch.object(cost_recorder, "connect")
def test_on_session_end_rolls_up(mock_connect):
    cm, cursor = _make_mock_conn((42,))
    mock_connect.return_value = cm

    cost_recorder.on_session_end(session_id="sess-1")

    calls = [str(c) for c in cursor.execute.call_args_list]
    assert any("UPDATE sessions" in c for c in calls), \
        "expected UPDATE sessions"
    assert any("UPDATE tasks" in c for c in calls), \
        "expected task rollup UPDATE"


@patch.object(cost_recorder, "connect")
def test_on_session_end_empty_session_id_is_noop(mock_connect):
    cost_recorder.on_session_end(session_id="")
    mock_connect.assert_not_called()


def test_register_registers_both_hooks():
    ctx = MagicMock()
    cost_recorder.register(ctx)
    registered = {c.args[0] for c in ctx.register_hook.call_args_list}
    assert registered == {"post_llm_call", "on_session_end"}
