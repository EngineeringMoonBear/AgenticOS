"""Tests for `agenticos_hermes.tasks.cost_report`."""
from unittest.mock import MagicMock, patch

from agenticos_hermes.tasks.cost_report import run_cost_report
from agenticos_hermes.workers.slm_runner import SlmResult


@patch("agenticos_hermes.tasks.cost_report.connect")
@patch("agenticos_hermes.tasks.cost_report.run_slm")
@patch("agenticos_hermes.tasks.cost_report.write_report_file")
@patch("agenticos_hermes.tasks.cost_report.record_task_start")
@patch("agenticos_hermes.tasks.cost_report.record_session_start")
@patch("agenticos_hermes.tasks.cost_report.record_session_end")
@patch("agenticos_hermes.tasks.cost_report.record_task_completion")
@patch("agenticos_hermes.tasks.cost_report.record_call")
def test_cost_report_writes_markdown(
    record_call,
    done,
    sess_end,
    sess_start,
    start,
    write_file,
    run_slm_mock,
    connect_mock,
):
    """Happy path: gather stats, format via SLM, write markdown, mark done."""
    cursor = MagicMock()
    cursor.fetchall.return_value = [
        ("daily-brief", 1, 18),
        ("inbox-triage", 3, 0),
    ]
    # Three fetchone() calls inside _gather_stats:
    #   1. (n_tasks, today_cents, cap, soft_pct)
    #   2. (mtd,)
    cursor.fetchone.side_effect = [
        (4, 18, 3000, 80),  # 4 tasks, $0.18 today, $30 cap, 80% soft alert
        (10,),              # $0.10 month-to-date (below alert)
    ]
    connect_mock.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cursor

    run_slm_mock.return_value = SlmResult(
        text="# Cost Report\n4 tasks, $0.18 today",
        model="qwen2.5:3b",
        input_tokens=80,
        output_tokens=40,
        latency_ms=300,
    )

    task_id = run_cost_report()

    write_file.assert_called_once()
    args, _ = write_file.call_args
    assert "Cost Report" in args[0]
    # mtd (10) < soft alert (3000*80/100=2400), so no alert banner prepended
    assert not args[0].startswith(">")

    done.assert_called_once_with(task_id=task_id, status="done")
    run_slm_mock.assert_called_once()
    assert run_slm_mock.call_args.kwargs["model"] == "qwen2.5:3b"
    record_call.assert_called_once()
    assert record_call.call_args.kwargs["provider"] == "ollama"


@patch("agenticos_hermes.tasks.cost_report.connect")
@patch("agenticos_hermes.tasks.cost_report.run_slm")
@patch("agenticos_hermes.tasks.cost_report.write_report_file")
@patch("agenticos_hermes.tasks.cost_report.record_task_start")
@patch("agenticos_hermes.tasks.cost_report.record_session_start")
@patch("agenticos_hermes.tasks.cost_report.record_session_end")
@patch("agenticos_hermes.tasks.cost_report.record_task_completion")
@patch("agenticos_hermes.tasks.cost_report.record_call")
def test_cost_report_prepends_alert_when_over_soft_cap(
    record_call,
    done,
    sess_end,
    sess_start,
    start,
    write_file,
    run_slm_mock,
    connect_mock,
):
    """If mtd_cents >= soft_alert_cents, an alert banner is prepended."""
    cursor = MagicMock()
    cursor.fetchall.return_value = [("daily-brief", 1, 18)]
    cursor.fetchone.side_effect = [
        (1, 18, 3000, 80),  # soft alert = 2400 cents
        (2500,),            # mtd > soft alert
    ]
    connect_mock.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cursor

    run_slm_mock.return_value = SlmResult(
        text="# Cost Report\nbody",
        model="qwen2.5:3b",
        input_tokens=10,
        output_tokens=10,
        latency_ms=100,
    )

    run_cost_report()

    args, _ = write_file.call_args
    assert args[0].startswith("> ")
    assert "Over soft alert" in args[0]
    assert "Cost Report" in args[0]
