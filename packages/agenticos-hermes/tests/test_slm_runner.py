import pytest
from unittest.mock import patch, MagicMock
from agenticos_hermes.workers.slm_runner import run_slm, SlmResult


@patch("agenticos_hermes.workers.slm_runner.httpx.Client")
def test_run_slm_parses_response(mock_client_cls):
    client = MagicMock()
    mock_client_cls.return_value.__enter__.return_value = client
    resp = MagicMock()
    resp.json.return_value = {
        "choices": [{"message": {"content": "category: farming"}}],
        "usage": {"prompt_tokens": 42, "completion_tokens": 8},
    }
    resp.raise_for_status = MagicMock()
    client.post.return_value = resp

    r = run_slm(model="qwen2.5:3b", prompt="classify this")
    assert isinstance(r, SlmResult)
    assert r.text == "category: farming"
    assert r.input_tokens == 42
    assert r.output_tokens == 8
    assert r.model == "qwen2.5:3b"
