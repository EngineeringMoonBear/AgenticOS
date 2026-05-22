"""Smoke test — verifies the package imports and exposes its version.

This is the only test in the skeleton; Tasks 10+ replace it with real tests.
It exists to give pytest something to collect (pytest exits 5 on no-tests-
collected, which the CI treats as a failure).
"""
import agenticos_hermes


def test_version_string() -> None:
    assert isinstance(agenticos_hermes.__version__, str)
    assert agenticos_hermes.__version__.count(".") >= 1
