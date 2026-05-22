"""inbox-watcher daemon.

Watches ``/opt/vault/inbox/`` for stable ``.md`` files. On detection:

  1. Debounce for ``INBOX_DEBOUNCE_SECONDS`` (default 5s).
  2. Confirm file size is stable (re-check after 200ms).
  3. Invoke ``python -m agenticos_hermes.tasks.inbox_triage <path>`` as a
     subprocess. If the module doesn't exist yet (Task 25 hasn't landed),
     log the failure and move on.

This is a standalone Docker daemon, NOT a Hermes plugin.
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

WATCH_DIR = Path(os.environ.get("INBOX_WATCH_DIR", "/opt/vault/inbox"))
DEBOUNCE_SECONDS = float(os.environ.get("INBOX_DEBOUNCE_SECONDS", "5.0"))
SUBPROCESS_TIMEOUT = float(os.environ.get("INBOX_SUBPROCESS_TIMEOUT", "300"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("inbox-watcher")


class Triager:
    """Debounced subprocess dispatcher for stable .md files."""

    def __init__(
        self,
        debounce_seconds: float = DEBOUNCE_SECONDS,
        subprocess_timeout: float = SUBPROCESS_TIMEOUT,
        runner=subprocess.run,
    ) -> None:
        self._debounce = debounce_seconds
        self._timeout = subprocess_timeout
        self._runner = runner
        self._pending: dict[Path, threading.Timer] = {}
        self._lock = threading.Lock()

    def on_event(self, path: Path) -> None:
        if path.suffix != ".md":
            return
        with self._lock:
            existing = self._pending.pop(path, None)
            if existing is not None:
                existing.cancel()
            t = threading.Timer(self._debounce, self._fire, args=(path,))
            self._pending[path] = t
            t.daemon = True
            t.start()

    def fire_now(self, path: Path) -> None:
        """Test hook: fire the stability check + subprocess synchronously."""
        self._fire(path)

    def _fire(self, path: Path) -> None:
        with self._lock:
            self._pending.pop(path, None)
        try:
            s1 = path.stat().st_size
            time.sleep(0.2)
            s2 = path.stat().st_size
        except FileNotFoundError:
            log.debug("file vanished before stability check: %s", path)
            return
        if s1 != s2:
            log.info("file %s still growing (%d -> %d), re-debouncing", path, s1, s2)
            self.on_event(path)
            return

        log.info("triggering inbox-triage for %s", path)
        try:
            self._runner(
                [
                    sys.executable,
                    "-m",
                    "agenticos_hermes.tasks.inbox_triage",
                    str(path),
                ],
                check=True,
                timeout=self._timeout,
            )
        except subprocess.CalledProcessError as e:
            log.error("inbox-triage failed for %s: rc=%s", path, e.returncode)
        except subprocess.TimeoutExpired:
            log.error("inbox-triage timed out for %s", path)
        except FileNotFoundError as e:
            log.error("inbox-triage runner missing (%s); is python on PATH?", e)


class _Handler(FileSystemEventHandler):
    def __init__(self, triager: Triager) -> None:
        self.triager = triager

    def on_created(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self.triager.on_event(Path(event.src_path))

    def on_modified(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self.triager.on_event(Path(event.src_path))


def main() -> None:
    WATCH_DIR.mkdir(parents=True, exist_ok=True)
    triager = Triager()
    observer = Observer()
    observer.schedule(_Handler(triager), str(WATCH_DIR), recursive=False)
    observer.start()
    log.info("watching %s (debounce=%ss)", WATCH_DIR, DEBOUNCE_SECONDS)
    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
