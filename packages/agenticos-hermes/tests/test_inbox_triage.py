"""Tests for `agenticos_hermes.tasks.inbox_triage`."""
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from agenticos_hermes.tasks.inbox_triage import triage_file
from agenticos_hermes.workers.slm_runner import SlmResult


@patch("agenticos_hermes.tasks.inbox_triage.connect")
@patch("agenticos_hermes.tasks.inbox_triage.run_slm")
def test_triage_file_routes_and_moves(
    run_slm_mock,
    connect_mock,
    tmp_path: Path,
):
    """Happy path: SLM classifies, file is moved, summary sidecar written."""
    cursor = MagicMock()
    connect_mock.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cursor

    inbox = tmp_path / "inbox"
    inbox.mkdir()
    src = inbox / "winter-forage.md"
    src.write_text("# Winter forage notes\n\nPlanning cover crops...")

    run_slm_mock.return_value = SlmResult(
        text=json.dumps(
            {
                "category": "farming",
                "subfolder": "forage",
                "summary": "Notes on winter forage planning.",
            }
        ),
        model="qwen2.5:3b",
        input_tokens=80,
        output_tokens=30,
        latency_ms=200,
    )

    with patch("agenticos_hermes.tasks.inbox_triage.VAULT_ROOT", tmp_path):
        task_id = triage_file(src)

    assert task_id.startswith("inbox-triage-")
    assert not src.exists(), "source should be moved out of inbox"
    dest = tmp_path / "farming" / "forage" / "winter-forage.md"
    assert dest.exists()
    summary = tmp_path / "farming" / "forage" / ".summaries" / "winter-forage.md"
    assert summary.exists()
    assert "winter forage" in summary.read_text().lower()

    # Verify DB writes happened: tasks insert, sessions insert, calls insert,
    # sessions update (ended_at), tasks update (completed_at).
    executed_sql = [c.args[0] for c in cursor.execute.call_args_list]
    assert any("INSERT INTO tasks" in s for s in executed_sql)
    assert any("INSERT INTO sessions" in s for s in executed_sql)
    assert any("INSERT INTO calls" in s for s in executed_sql)
    assert any("UPDATE sessions" in s for s in executed_sql)
    assert any("UPDATE tasks" in s for s in executed_sql)

    run_slm_mock.assert_called_once()
    assert run_slm_mock.call_args.kwargs["model"] == "qwen2.5:3b"


@patch("agenticos_hermes.tasks.inbox_triage.connect")
@patch("agenticos_hermes.tasks.inbox_triage.run_slm")
def test_triage_file_handles_fenced_json(
    run_slm_mock,
    connect_mock,
    tmp_path: Path,
):
    """SLM responses wrapped in ```json fences should still parse."""
    cursor = MagicMock()
    connect_mock.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cursor

    inbox = tmp_path / "inbox"
    inbox.mkdir()
    src = inbox / "campaign-ideas.md"
    src.write_text("# Marketing")

    run_slm_mock.return_value = SlmResult(
        text=(
            "Sure! Here you go:\n```json\n"
            '{"category": "marketing", "subfolder": "campaigns",'
            ' "summary": "Brainstorm of Q3 campaign ideas."}\n'
            "```"
        ),
        model="qwen2.5:3b",
        input_tokens=50,
        output_tokens=40,
        latency_ms=150,
    )

    with patch("agenticos_hermes.tasks.inbox_triage.VAULT_ROOT", tmp_path):
        triage_file(src)

    assert (tmp_path / "marketing" / "campaigns" / "campaign-ideas.md").exists()


@patch("agenticos_hermes.tasks.inbox_triage.connect")
@patch("agenticos_hermes.tasks.inbox_triage.run_slm")
def test_triage_file_failed_records_failure(
    run_slm_mock,
    connect_mock,
    tmp_path: Path,
):
    """Unparseable SLM output raises, and the task is marked failed."""
    cursor = MagicMock()
    connect_mock.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cursor

    inbox = tmp_path / "inbox"
    inbox.mkdir()
    src = inbox / "junk.md"
    src.write_text("# something")

    run_slm_mock.return_value = SlmResult(
        text="no json here at all",
        model="qwen2.5:3b",
        input_tokens=10,
        output_tokens=5,
        latency_ms=50,
    )

    with patch("agenticos_hermes.tasks.inbox_triage.VAULT_ROOT", tmp_path):
        try:
            triage_file(src)
        except ValueError:
            pass
        else:
            raise AssertionError("expected ValueError on unparseable JSON")

    # Source still in place (no rename happened).
    assert src.exists()
    # Task was marked failed (UPDATE tasks with status='failed').
    update_calls = [
        c for c in cursor.execute.call_args_list
        if "UPDATE tasks" in c.args[0]
    ]
    assert update_calls, "task completion should be recorded"
    # The status param is the first positional in the tuple of params.
    assert update_calls[-1].args[1][0] == "failed"
