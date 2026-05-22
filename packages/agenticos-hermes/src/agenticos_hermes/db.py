"""Postgres connection helper. Plugin/task code uses `with connect() as conn:`.

We use psycopg3 sync — Hermes calls our hook functions synchronously and our
cron tasks are batch-oriented; async would add complexity for no win.
"""
import os
from contextlib import contextmanager
from typing import Iterator

import psycopg


def build_db_url() -> str:
    """Read AGENTICOS_DB_URL from env. Raises if unset."""
    url = os.environ.get("AGENTICOS_DB_URL")
    if not url:
        raise RuntimeError("AGENTICOS_DB_URL not set in environment")
    return url


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """Yield a Postgres connection. Commits on clean exit, rolls back on error."""
    with psycopg.connect(build_db_url()) as conn:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
