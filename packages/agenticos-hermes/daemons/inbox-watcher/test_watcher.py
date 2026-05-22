"""Tests for the inbox-watcher daemon."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Ensure the daemon directory is importable when running pytest from the
# agenticos-hermes package root.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import watcher  # noqa: E402


def test_non_md_files_ignored(tmp_path: Path) -> None:
    runner = MagicMock()
    triager = watcher.Triager(debounce_seconds=0.01, runner=runner)
    f = tmp_path / "note.txt"
    f.write_text("hello")
    triager.on_event(f)
    # No timer should be pending and no subprocess should fire.
    assert runner.call_count == 0


def test_stable_md_file_triggers_subprocess(tmp_path: Path) -> None:
    runner = MagicMock()
    triager = watcher.Triager(debounce_seconds=0.01, runner=runner)
    f = tmp_path / "inbox-item.md"
    f.write_text("# inbox note\n")

    # Fire synchronously to avoid threading flakiness.
    triager.fire_now(f)

    assert runner.call_count == 1
    args, kwargs = runner.call_args
    cmd = args[0]
    assert cmd[1:] == ["-m", "agenticos_hermes.tasks.inbox_triage", str(f)]
    assert kwargs.get("check") is True
    assert "timeout" in kwargs


def test_missing_file_is_skipped(tmp_path: Path) -> None:
    runner = MagicMock()
    triager = watcher.Triager(debounce_seconds=0.01, runner=runner)
    triager.fire_now(tmp_path / "ghost.md")
    assert runner.call_count == 0


def test_subprocess_failure_is_logged_not_raised(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    import subprocess

    def runner(cmd, **kwargs):  # noqa: ARG001
        raise subprocess.CalledProcessError(returncode=1, cmd=cmd)

    triager = watcher.Triager(debounce_seconds=0.01, runner=runner)
    f = tmp_path / "broken.md"
    f.write_text("x")
    with caplog.at_level("ERROR", logger="inbox-watcher"):
        triager.fire_now(f)  # Must not raise.
    assert any("inbox-triage failed" in r.message for r in caplog.records)
