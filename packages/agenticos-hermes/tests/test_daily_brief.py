"""Tests for the daily-brief cron task entrypoint.

All external dependencies (Postgres, OpenViking, Codex CLI, filesystem)
are mocked. There are no live calls.
"""
from __future__ import annotations

import pytest
from unittest.mock import patch, MagicMock

from agenticos_hermes.tasks.daily_brief import run_daily_brief
from agenticos_hermes.workers.codex_coder import CodexResult


def _codex_result(text: str = "# Daily Brief\n\nAll looks well.") -> CodexResult:
    return CodexResult(
        text=text,
        model="gpt-5-codex",
        input_tokens=200,
        cached_input_tokens=0,
        output_tokens=100,
        reasoning_output_tokens=0,
        latency_ms=2000,
    )


@patch("agenticos_hermes.tasks.daily_brief.write_brief_file")
@patch("agenticos_hermes.tasks.daily_brief.fetch_yesterday_task_summary")
@patch("agenticos_hermes.tasks.daily_brief.openviking_search")
@patch("agenticos_hermes.tasks.daily_brief.run_codex")
@patch("agenticos_hermes.tasks.daily_brief.record_call")
@patch("agenticos_hermes.tasks.daily_brief.record_task_completion")
@patch("agenticos_hermes.tasks.daily_brief.record_session_end")
@patch("agenticos_hermes.tasks.daily_brief.record_session_start")
@patch("agenticos_hermes.tasks.daily_brief.record_task_start")
def test_daily_brief_happy_path(
    record_start,
    record_sess_start,
    record_sess_end,
    record_done,
    record_call,
    run_cdx,
    ov_search,
    yesterday,
    write_file,
):
    ov_search.return_value = [{"id": "m1", "text": "yesterday's note"}]
    yesterday.return_value = [("daily-brief", 1, 18)]
    run_cdx.return_value = _codex_result()

    result = run_daily_brief()

    assert result.startswith("daily-brief-")
    record_start.assert_called_once()
    start_kwargs = record_start.call_args.kwargs
    assert start_kwargs["task_id"] == result
    assert start_kwargs["kind"] == "daily-brief"
    assert start_kwargs["trigger"] == "cron:daily-brief"

    record_sess_start.assert_called_once()
    sess_kwargs = record_sess_start.call_args.kwargs
    assert sess_kwargs["task_id"] == result
    assert sess_kwargs["hermes_skill"] == "codex-coder"

    # Codex called with a prompt that includes the OpenViking memory text
    run_cdx.assert_called_once()
    cdx_kwargs = run_cdx.call_args.kwargs
    assert cdx_kwargs["task_id"] == result
    assert "yesterday's note" in cdx_kwargs["prompt"]

    # Call recorded
    record_call.assert_called_once()
    call_kwargs = record_call.call_args.kwargs
    assert call_kwargs["provider"] == "openai"
    assert call_kwargs["model"] == "gpt-5-codex"
    assert call_kwargs["input_tokens"] == 200
    assert call_kwargs["output_tokens"] == 100

    # Brief written
    write_file.assert_called_once()
    write_args, _ = write_file.call_args
    assert "# Daily Brief" in write_args[0]

    record_sess_end.assert_called_once()
    record_done.assert_called_once_with(task_id=result, status="done")


@patch("agenticos_hermes.tasks.daily_brief.write_brief_file")
@patch("agenticos_hermes.tasks.daily_brief.fetch_yesterday_task_summary")
@patch("agenticos_hermes.tasks.daily_brief.openviking_search")
@patch("agenticos_hermes.tasks.daily_brief.run_codex")
@patch("agenticos_hermes.tasks.daily_brief.record_call")
@patch("agenticos_hermes.tasks.daily_brief.record_task_completion")
@patch("agenticos_hermes.tasks.daily_brief.record_session_end")
@patch("agenticos_hermes.tasks.daily_brief.record_session_start")
@patch("agenticos_hermes.tasks.daily_brief.record_task_start")
def test_daily_brief_records_failure_and_reraises(
    record_start,
    record_sess_start,
    record_sess_end,
    record_done,
    record_call,
    run_cdx,
    ov_search,
    yesterday,
    write_file,
):
    """If Codex fails, session_end + task_completion(status=failed) are recorded
    and the exception bubbles up."""
    ov_search.return_value = []
    yesterday.return_value = []
    run_cdx.side_effect = RuntimeError("codex blew up")

    with pytest.raises(RuntimeError, match="codex blew up"):
        run_daily_brief()

    write_file.assert_not_called()
    record_sess_end.assert_called_once()
    record_done.assert_called_once()
    done_kwargs = record_done.call_args.kwargs
    assert done_kwargs["status"] == "failed"
    assert "codex blew up" in done_kwargs["error"]


@patch("agenticos_hermes.tasks.daily_brief.httpx.Client")
def test_openviking_search_uses_verified_endpoint(client_cls, monkeypatch):
    """openviking_search hits POST /api/v1/search/find with Bearer auth."""
    from agenticos_hermes.tasks import daily_brief as mod

    monkeypatch.setattr(mod, "OPENVIKING_ENDPOINT", "http://ov.test:1933")
    monkeypatch.setattr(mod, "OPENVIKING_ROOT_API_KEY", "secret-key")

    instance = MagicMock()
    client_cls.return_value.__enter__.return_value = instance
    resp = MagicMock()
    resp.json.return_value = {"results": [{"id": "m1", "text": "hi"}]}
    instance.post.return_value = resp

    results = mod.openviking_search("q", top_k=5)

    assert results == [{"id": "m1", "text": "hi"}]
    instance.post.assert_called_once()
    call_args = instance.post.call_args
    assert call_args.args[0] == "http://ov.test:1933/api/v1/search/find"
    assert call_args.kwargs["json"] == {"query": "q", "top_k": 5}
    assert call_args.kwargs["headers"]["Authorization"] == "Bearer secret-key"


def test_write_brief_file_writes_markdown(tmp_path, monkeypatch):
    from datetime import date as date_cls
    from agenticos_hermes.tasks import daily_brief as mod

    monkeypatch.setattr(mod, "VAULT_ROOT", tmp_path)
    out = mod.write_brief_file("# hello\n", date_cls(2026, 5, 23))
    assert out == tmp_path / "daily-briefs" / "2026-05-23.md"
    assert out.read_text() == "# hello\n"
