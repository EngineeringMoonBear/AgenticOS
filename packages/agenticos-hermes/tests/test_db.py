import pytest
from agenticos_hermes.db import build_db_url

def test_build_db_url_from_env(monkeypatch):
    monkeypatch.setenv("AGENTICOS_DB_URL", "postgresql://x:y@h:5432/d")
    assert build_db_url() == "postgresql://x:y@h:5432/d"

def test_missing_raises(monkeypatch):
    monkeypatch.delenv("AGENTICOS_DB_URL", raising=False)
    with pytest.raises(RuntimeError, match="AGENTICOS_DB_URL"):
        build_db_url()
