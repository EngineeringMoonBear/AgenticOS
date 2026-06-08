"""Tests for the vault-ingest cron task.

Walker + sha helpers run without dependencies. DAO + run-loop tests are
gated on AGENTICOS_DB_URL being set (mirrors test_daily_brief.py pattern
which fully mocks DB; here we exercise real DAO so we use a DB gate).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from agenticos_hermes.tasks.vault_ingest import (
    FakeViking,
    IngestRow,
    delete_ingest_row,
    file_sha256,
    get_tracked_sha,
    list_tracked_paths,
    run_ingest,
    upsert_ingest_row,
    viking_uri_for,
    VaultItem,
    walk_vault,
)

needs_db = pytest.mark.skipif(
    not os.environ.get("AGENTICOS_DB_URL"),
    reason="needs AGENTICOS_DB_URL set",
)


# ---------------------------------------------------------------------------
# Walker / sha (no DB)
# ---------------------------------------------------------------------------

def test_walk_vault_yields_farming_and_loose(tmp_path: Path):
    (tmp_path / "farming" / "pasture").mkdir(parents=True)
    (tmp_path / "farming" / "pasture" / "rotation.md").write_text("a")
    (tmp_path / "inbox").mkdir()  # must be skipped
    (tmp_path / "inbox" / "note.md").write_text("skip me")
    (tmp_path / ".stfolder").mkdir()
    (tmp_path / ".stfolder" / "x.md").write_text("skip me")
    (tmp_path / "HELLO.md").write_text("loose")
    items = {(p.path.name, p.scope) for p in walk_vault(tmp_path)}
    assert items == {("rotation.md", "farming"), ("HELLO.md", "notes")}


def test_walk_vault_missing_root_is_empty(tmp_path: Path):
    assert list(walk_vault(tmp_path / "does-not-exist")) == []


def test_walk_vault_ignores_non_md_files(tmp_path: Path):
    (tmp_path / "farming").mkdir()
    (tmp_path / "farming" / "x.md").write_text("md")
    (tmp_path / "farming" / "y.txt").write_text("nope")
    (tmp_path / "README").write_text("nope")
    items = {p.path.name for p in walk_vault(tmp_path)}
    assert items == {"x.md"}


def test_walk_vault_skips_dotfile_dirs_recursively(tmp_path: Path):
    """Regression: production probe 2026-05-28 found `.summaries/` files
    were being ingested because rglob doesn't prune dotfile subdirs.
    The fix walks recursively and excludes any dir whose name starts
    with `.` at any depth."""
    (tmp_path / "farming" / "pasture" / ".summaries").mkdir(parents=True)
    (tmp_path / "farming" / "pasture" / ".summaries" / "rotation.md").write_text("skip")
    (tmp_path / "farming" / "pasture" / "rotation.md").write_text("keep")
    (tmp_path / "farming" / ".obsidian").mkdir()
    (tmp_path / "farming" / ".obsidian" / "config.md").write_text("skip")
    items = {(p.path.name, p.scope) for p in walk_vault(tmp_path)}
    assert items == {("rotation.md", "farming")}


def test_file_sha256_stable(tmp_path: Path):
    p = tmp_path / "x.md"
    p.write_text("hello")
    h1 = file_sha256(p)
    h2 = file_sha256(p)
    assert h1 == h2
    assert len(h1) == 64


def test_file_sha256_changes_with_content(tmp_path: Path):
    p = tmp_path / "x.md"
    p.write_text("hello")
    h1 = file_sha256(p)
    p.write_text("world")
    h2 = file_sha256(p)
    assert h1 != h2


def test_viking_uri_for_loose_and_scoped(tmp_path: Path):
    (tmp_path / "farming" / "p").mkdir(parents=True)
    loose = tmp_path / "HELLO.md"
    loose.write_text("x")
    scoped = tmp_path / "farming" / "p" / "rotation.md"
    scoped.write_text("y")

    assert (
        viking_uri_for(VaultItem(loose, "notes"), tmp_path)
        == "viking://resources/HELLO.md"
    )
    assert (
        viking_uri_for(VaultItem(scoped, "farming"), tmp_path)
        == "viking://resources/farming/p/rotation.md"
    )


# ---------------------------------------------------------------------------
# DAO + run-loop (need DB)
# ---------------------------------------------------------------------------

@pytest.fixture
def clean_table():
    """Truncate vault_ingest_state + any vault-ingest task rows before each test."""
    from agenticos_hermes.db import connect

    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM vault_ingest_state")
        cur.execute("DELETE FROM tasks WHERE kind = 'vault-ingest'")
    yield
    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM vault_ingest_state")
        cur.execute("DELETE FROM tasks WHERE kind = 'vault-ingest'")


@needs_db
def test_dao_upsert_and_get_and_delete(clean_table):
    row = IngestRow(
        path="/x/a.md",
        sha256="a" * 64,
        scope="farming",
        viking_uri="viking://resources/farming/a.md",
        status="ok",
    )
    upsert_ingest_row(row)
    assert get_tracked_sha("/x/a.md") == "a" * 64
    assert "/x/a.md" in list_tracked_paths()

    # Upsert with new sha
    upsert_ingest_row(IngestRow(
        path="/x/a.md",
        sha256="b" * 64,
        scope="farming",
        viking_uri="viking://resources/farming/a.md",
        status="ok",
    ))
    assert get_tracked_sha("/x/a.md") == "b" * 64

    delete_ingest_row("/x/a.md")
    assert get_tracked_sha("/x/a.md") is None


@needs_db
def test_run_ingest_adds_new_file(tmp_path, clean_table):
    (tmp_path / "farming").mkdir()
    (tmp_path / "farming" / "a.md").write_text("hello")
    fake = FakeViking()
    summary = run_ingest(vault_root=tmp_path, viking=fake)
    assert summary["added"] == 1
    assert summary["skipped"] == 0
    assert summary["errored"] == 0
    assert fake.added == [
        (str(tmp_path / "farming" / "a.md"), "viking://resources/farming/a.md")
    ]


@needs_db
def test_run_ingest_skips_unchanged(tmp_path, clean_table):
    (tmp_path / "farming").mkdir()
    (tmp_path / "farming" / "a.md").write_text("hello")
    fake = FakeViking()
    run_ingest(vault_root=tmp_path, viking=fake)
    fake2 = FakeViking()
    summary = run_ingest(vault_root=tmp_path, viking=fake2)
    assert summary["skipped"] == 1
    assert summary["added"] == 0
    assert fake2.added == []


@needs_db
def test_run_ingest_detects_change(tmp_path, clean_table):
    (tmp_path / "farming").mkdir()
    md = tmp_path / "farming" / "a.md"
    md.write_text("hello")
    run_ingest(vault_root=tmp_path, viking=FakeViking())
    md.write_text("changed")
    fake = FakeViking()
    summary = run_ingest(vault_root=tmp_path, viking=fake)
    assert summary["updated"] == 1
    assert summary["added"] == 0


@needs_db
def test_run_ingest_detects_deletion(tmp_path, clean_table):
    (tmp_path / "farming").mkdir()
    md = tmp_path / "farming" / "a.md"
    md.write_text("hello")
    run_ingest(vault_root=tmp_path, viking=FakeViking())
    md.unlink()
    fake = FakeViking()
    summary = run_ingest(vault_root=tmp_path, viking=fake)
    assert summary["removed"] == 1
    assert fake.removed == ["viking://resources/farming/a.md"]


@needs_db
def test_run_ingest_counts_errors_but_continues(tmp_path, clean_table):
    (tmp_path / "farming").mkdir()
    (tmp_path / "farming" / "a.md").write_text("hello")
    (tmp_path / "farming" / "b.md").write_text("hello2")
    fake = FakeViking()
    fake.fail_paths = {str(tmp_path / "farming" / "a.md")}
    summary = run_ingest(vault_root=tmp_path, viking=fake)
    assert summary["errored"] == 1
    assert summary["added"] == 1  # b.md still uploaded


@needs_db
def test_run_ingest_writes_running_then_done_ledger_row(tmp_path, clean_table):
    from agenticos_hermes.db import connect

    (tmp_path / "farming").mkdir()
    (tmp_path / "farming" / "a.md").write_text("hi")
    run_ingest(vault_root=tmp_path, viking=FakeViking())
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT kind, status, metadata FROM tasks "
            "WHERE kind='vault-ingest' ORDER BY started_at DESC LIMIT 1"
        )
        rows = cur.fetchall()
    assert rows
    assert rows[0][0] == "vault-ingest"
    assert rows[0][1] == "done"
    md = rows[0][2] if isinstance(rows[0][2], dict) else json.loads(rows[0][2])
    assert md["added"] == 1


def test_rm_passes_recursive_flag(monkeypatch):
    """OpenViking stores each ingested resource as a DIRECTORY (content +
    .abstract.md / .overview.md children), so DELETE /api/v1/fs must pass
    recursive=true or it 412s with "Cannot remove directory without
    --recursive" — the bug that stalled hourly deletion reconciliation.
    """
    from agenticos_hermes.tasks import vault_ingest as vi

    captured: dict[str, object] = {}

    class _Resp:
        status_code = 200

        def raise_for_status(self) -> None:
            pass

    class _Client:
        def __init__(self, *a, **k) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a) -> bool:
            return False

        def delete(self, url, headers=None, params=None):
            captured["url"] = url
            captured["params"] = params
            return _Resp()

    monkeypatch.setattr(vi.httpx, "Client", _Client)
    client = vi.HttpxVikingClient(endpoint="http://viking.test", api_key="k")
    client.rm("viking://resources/HELLO-FROM-MAC.md")

    assert captured["params"]["uri"] == "viking://resources/HELLO-FROM-MAC.md"
    assert captured["params"]["recursive"] == "true"
