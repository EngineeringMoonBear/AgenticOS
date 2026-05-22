import json
import pytest
from unittest.mock import patch, MagicMock
from agenticos_hermes.workers import codex_coder
from agenticos_hermes.workers.codex_coder import run_codex, CodexResult


@pytest.fixture(autouse=True)
def _isolated_work_root(tmp_path, monkeypatch):
    monkeypatch.setattr(codex_coder, "WORK_ROOT", tmp_path)


@patch("agenticos_hermes.workers.codex_coder.subprocess.run")
def test_run_codex_parses_verified_jsonl(mock_run):
    # Real shape from a successful gpt-5-codex run (spec1-verified-api-shapes.md §2)
    events = [
        json.dumps({"type": "thread.started", "thread_id": "abc-123"}),
        json.dumps({"type": "turn.started"}),
        json.dumps({"type": "item.completed",
                    "item": {"id": "item_0", "type": "agent_message", "text": "PONG"}}),
        json.dumps({"type": "turn.completed",
                    "usage": {"input_tokens": 11754, "cached_input_tokens": 10624,
                              "output_tokens": 6, "reasoning_output_tokens": 0}}),
    ]
    mock_run.return_value = MagicMock(
        returncode=0, stdout="\n".join(events) + "\n", stderr="",
    )

    r = run_codex(prompt="say PONG", task_id="task-1")
    assert isinstance(r, CodexResult)
    assert r.text == "PONG"
    assert r.input_tokens == 11754
    assert r.cached_input_tokens == 10624
    assert r.output_tokens == 6
    assert r.reasoning_output_tokens == 0


@patch("agenticos_hermes.workers.codex_coder.subprocess.run")
def test_run_codex_concatenates_multiple_agent_messages(mock_run):
    events = [
        json.dumps({"type": "thread.started", "thread_id": "abc"}),
        json.dumps({"type": "turn.started"}),
        json.dumps({"type": "item.completed",
                    "item": {"id": "i0", "type": "agent_message", "text": "Part 1 "}}),
        json.dumps({"type": "item.completed",
                    "item": {"id": "i1", "type": "agent_message", "text": "Part 2"}}),
        json.dumps({"type": "turn.completed",
                    "usage": {"input_tokens": 10, "cached_input_tokens": 0,
                              "output_tokens": 5, "reasoning_output_tokens": 0}}),
    ]
    mock_run.return_value = MagicMock(returncode=0, stdout="\n".join(events), stderr="")
    r = run_codex(prompt="x", task_id="t")
    assert r.text == "Part 1 Part 2"


@patch("agenticos_hermes.workers.codex_coder.subprocess.run")
def test_run_codex_raises_on_turn_failed(mock_run):
    events = [
        json.dumps({"type": "thread.started", "thread_id": "abc"}),
        json.dumps({"type": "turn.started"}),
        json.dumps({"type": "error", "message": "Quota exceeded."}),
        json.dumps({"type": "turn.failed",
                    "error": {"message": "Quota exceeded."}}),
    ]
    mock_run.return_value = MagicMock(returncode=0, stdout="\n".join(events), stderr="")
    with pytest.raises(RuntimeError, match="Quota exceeded"):
        run_codex(prompt="x", task_id="t")
