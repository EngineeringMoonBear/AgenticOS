"""vault-ingest: hourly walker that pushes /opt/vault markdown to OpenViking.

Phase 1A of v2-unified-dashboard. Walks /opt/vault, skips inbox/ (handled
by inbox-watcher) and dotfile dirs (.stfolder etc.), computes sha256 of
each *.md file, and reconciles against the `vault_ingest_state` table:

  - new file        → upload via Viking temp_upload + add_resource, INSERT row
  - changed sha     → re-upload, UPDATE row
  - unchanged sha   → skip
  - tracked but gone on disk → DELETE viking resource + DELETE row

Records a single `tasks` row per run (kind='vault-ingest') with summary
counts in metadata so the dashboard's Live-Ops feed picks it up.

The Viking POST resource flow per the verified OpenAPI snapshot
(docs/reference/openviking-v0.3.19-openapi.json) is two-step:
  1. POST /api/v1/resources/temp_upload  (multipart file=@...)
     → returns {"temp_file_id": "..."}
  2. POST /api/v1/resources  (JSON {"temp_file_id": "...", "to": "viking://..."})
Removal is DELETE /api/v1/fs?uri=<viking_uri>.
"""
from __future__ import annotations

import hashlib
import json
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, Optional, Protocol

import httpx

from ..db import connect

OPENVIKING_ENDPOINT = os.environ.get(
    "OPENVIKING_ENDPOINT", "http://openviking:1933"
)
OPENVIKING_ROOT_API_KEY = os.environ.get("OPENVIKING_ROOT_API_KEY", "")

INBOX_DIRNAME = "inbox"  # handled separately by inbox-watcher daemon


# ---------------------------------------------------------------------------
# Walker
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class VaultItem:
    path: Path
    scope: str


def walk_vault(root: Path = Path("/opt/vault")) -> Iterator[VaultItem]:
    """Yield every ingestable *.md file under `root`.

    Rules (matches production /opt/vault layout, see plan Task 1.2):
      - skip dotfile-prefixed top-level dirs (.stfolder etc.)
      - skip the inbox/ dir (inbox-watcher daemon handles it)
      - loose top-level *.md files → scope="notes"
      - *.md inside any other top-level dir → scope=<top_dir_name>, recursive
    """
    if not root.exists():
        return
    for entry in sorted(root.iterdir()):
        name = entry.name
        if name.startswith("."):
            continue
        if entry.is_dir():
            if name == INBOX_DIRNAME:
                continue
            scope = name
            for md in sorted(entry.rglob("*.md")):
                if md.is_file():
                    yield VaultItem(path=md, scope=scope)
        elif entry.is_file() and name.endswith(".md"):
            yield VaultItem(path=entry, scope="notes")


def file_sha256(path: Path) -> str:
    """Compute hex sha256 of a file in 64KiB chunks."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def viking_uri_for(item: VaultItem, vault_root: Path) -> str:
    """Build the canonical viking:// URI for a vault item.

    Loose top-level notes:  /<root>/HELLO.md   → viking://resources/notes/HELLO.md
    Scoped:    /<root>/farming/x/y.md          → viking://resources/farming/x/y.md
    """
    if item.scope == "notes" and item.path.parent == vault_root:
        rel = item.path.name
    else:
        # path is somewhere under vault_root/<scope>/...
        rel = item.path.relative_to(vault_root).as_posix()
    return f"viking://resources/{rel}"


# ---------------------------------------------------------------------------
# DAO
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class IngestRow:
    path: str
    sha256: str
    scope: str
    viking_uri: str
    status: str  # 'ok' | 'errored'
    error: Optional[str] = None


def upsert_ingest_row(row: IngestRow) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO vault_ingest_state
                 (path, sha256, scope, viking_uri, last_ingested, status, error)
               VALUES (%s, %s, %s, %s, now(), %s, %s)
               ON CONFLICT (path) DO UPDATE SET
                 sha256        = EXCLUDED.sha256,
                 scope         = EXCLUDED.scope,
                 viking_uri    = EXCLUDED.viking_uri,
                 last_ingested = now(),
                 status        = EXCLUDED.status,
                 error         = EXCLUDED.error""",
            (row.path, row.sha256, row.scope, row.viking_uri, row.status, row.error),
        )


def delete_ingest_row(path: str) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM vault_ingest_state WHERE path = %s", (path,))


def list_tracked_paths() -> set[str]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT path FROM vault_ingest_state")
        return {r[0] for r in cur.fetchall()}


def get_tracked_sha(path: str) -> Optional[str]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT sha256 FROM vault_ingest_state WHERE path = %s", (path,)
        )
        row = cur.fetchone()
        return row[0] if row else None


def get_tracked_viking_uri(path: str) -> Optional[str]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT viking_uri FROM vault_ingest_state WHERE path = %s", (path,)
        )
        row = cur.fetchone()
        return row[0] if row else None


# ---------------------------------------------------------------------------
# Task-ledger helpers (kind='vault-ingest').
# Match the inline-recorder pattern used by daily_brief.py — tests patch
# these at `agenticos_hermes.tasks.vault_ingest.record_*`.
# ---------------------------------------------------------------------------

def record_task_start(
    *,
    task_id: str,
    kind: str,
    trigger: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO tasks (id, kind, trigger, started_at, status, metadata)
               VALUES (%s, %s, %s, now(), 'running', %s::jsonb)""",
            (task_id, kind, trigger, json.dumps(metadata or {})),
        )


def record_task_completion(
    *,
    task_id: str,
    status: str,
    error: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Update a `tasks` row with terminal status. Optionally merge metadata."""
    with connect() as conn, conn.cursor() as cur:
        if metadata is not None:
            cur.execute(
                """UPDATE tasks
                   SET status = %s,
                       ended_at = now(),
                       error = %s,
                       metadata = metadata || %s::jsonb
                   WHERE id = %s""",
                (status, error, json.dumps(metadata), task_id),
            )
        else:
            cur.execute(
                """UPDATE tasks
                   SET status = %s, ended_at = now(), error = %s
                   WHERE id = %s""",
                (status, error, task_id),
            )


# ---------------------------------------------------------------------------
# Viking client (protocol + real + fake).
# ---------------------------------------------------------------------------

class VikingClient(Protocol):
    def add_resource(self, file_path: str, viking_uri: str) -> str: ...
    def rm(self, uri: str) -> None: ...


class FakeViking:
    """Test double that records calls instead of hitting the network."""

    def __init__(self) -> None:
        self.added: list[tuple[str, str]] = []
        self.removed: list[str] = []
        self.fail_paths: set[str] = set()

    def add_resource(self, file_path: str, viking_uri: str) -> str:
        if file_path in self.fail_paths:
            raise RuntimeError(f"FakeViking forced failure for {file_path}")
        self.added.append((file_path, viking_uri))
        return viking_uri

    def rm(self, uri: str) -> None:
        self.removed.append(uri)


class HttpxVikingClient:
    """Real Viking client using the verified two-step upload flow.

    Step 1: POST /api/v1/resources/temp_upload  (multipart file)
            → {"temp_file_id": "..."}
    Step 2: POST /api/v1/resources              (JSON {temp_file_id, to})
            → resource record
    Remove: DELETE /api/v1/fs?uri=<viking_uri>
    """

    def __init__(
        self,
        endpoint: str | None = None,
        api_key: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.endpoint = (endpoint or OPENVIKING_ENDPOINT).rstrip("/")
        self.api_key = api_key if api_key is not None else OPENVIKING_ROOT_API_KEY
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        headers = {
            "X-OpenViking-Account": "agenticos",
            "X-OpenViking-User": "deploy",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def add_resource(self, file_path: str, viking_uri: str) -> str:
        with httpx.Client(timeout=self.timeout) as client:
            with open(file_path, "rb") as fh:
                upload = client.post(
                    f"{self.endpoint}/api/v1/resources/temp_upload",
                    headers=self._headers(),
                    files={"file": (Path(file_path).name, fh, "text/markdown")},
                )
            upload.raise_for_status()
            body = upload.json()
            temp_file_id = body.get("temp_file_id") or body.get("id")
            if not temp_file_id:
                raise RuntimeError(
                    f"temp_upload returned no temp_file_id: {body!r}"
                )

            resp = client.post(
                f"{self.endpoint}/api/v1/resources",
                headers={**self._headers(), "Content-Type": "application/json"},
                json={
                    "temp_file_id": temp_file_id,
                    "to": viking_uri,
                    "create_parent": True,
                },
            )
            resp.raise_for_status()
        return viking_uri

    def rm(self, uri: str) -> None:
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.delete(
                f"{self.endpoint}/api/v1/fs",
                headers=self._headers(),
                params={"uri": uri},
            )
            # 404 on already-gone resource is fine; surface other errors.
            if resp.status_code == 404:
                return
            resp.raise_for_status()


# ---------------------------------------------------------------------------
# Main run loop.
# ---------------------------------------------------------------------------

def run_ingest(
    vault_root: Path = Path("/opt/vault"),
    viking: VikingClient | None = None,
) -> dict[str, int]:
    """Walk vault, reconcile with Viking + ingest-state, emit task-ledger row.

    Returns a summary dict: {added, updated, removed, skipped, errored}.
    """
    if viking is None:
        viking = HttpxVikingClient()

    task_id = f"vault-ingest-{uuid.uuid4().hex[:10]}"
    record_task_start(
        task_id=task_id,
        kind="vault-ingest",
        trigger="cron",
        metadata={"vault_root": str(vault_root)},
    )

    summary = {
        "added": 0,
        "updated": 0,
        "removed": 0,
        "skipped": 0,
        "errored": 0,
    }

    try:
        tracked = list_tracked_paths()
        seen: set[str] = set()

        for item in walk_vault(vault_root):
            path_str = str(item.path)
            seen.add(path_str)
            try:
                sha = file_sha256(item.path)
                prior_sha = get_tracked_sha(path_str)
                if prior_sha == sha:
                    summary["skipped"] += 1
                    continue
                uri = viking_uri_for(item, vault_root)
                viking.add_resource(path_str, uri)
                upsert_ingest_row(
                    IngestRow(
                        path=path_str,
                        sha256=sha,
                        scope=item.scope,
                        viking_uri=uri,
                        status="ok",
                    )
                )
                if prior_sha is None:
                    summary["added"] += 1
                else:
                    summary["updated"] += 1
            except Exception as exc:
                summary["errored"] += 1
                try:
                    upsert_ingest_row(
                        IngestRow(
                            path=path_str,
                            sha256="0" * 64,
                            scope=item.scope,
                            viking_uri=viking_uri_for(item, vault_root),
                            status="errored",
                            error=str(exc)[:500],
                        )
                    )
                except Exception:
                    pass

        # Reconcile deletions: tracked paths not seen on disk.
        for stale_path in tracked - seen:
            try:
                uri = get_tracked_viking_uri(stale_path)
                if uri:
                    viking.rm(uri)
                delete_ingest_row(stale_path)
                summary["removed"] += 1
            except Exception:
                summary["errored"] += 1

        # Status: 'done' if no errors OR if we made forward progress.
        if summary["errored"] == 0 or (summary["added"] + summary["updated"] > 0):
            status = "done"
            err = None
        else:
            status = "failed"
            err = f"all {summary['errored']} files errored"

        record_task_completion(
            task_id=task_id,
            status=status,
            error=err,
            metadata=summary,
        )
    except Exception as exc:
        record_task_completion(
            task_id=task_id,
            status="failed",
            error=str(exc)[:500],
            metadata=summary,
        )
        raise

    return summary


if __name__ == "__main__":
    print(json.dumps(run_ingest()))
