from unittest.mock import patch

from agenticos_hermes.routing import route


@patch("agenticos_hermes.routing._mtd_cost_cents", return_value=3001)
@patch("agenticos_hermes.routing._budget_cap_cents", return_value=3000)
def test_budget_blocked_forces_slm(_cap, _mtd):
    d = route(kind="daily-brief", complexity="high", context_tokens=1000)
    assert d.provider == "ollama"
    assert d.budget_blocked is True


@patch("agenticos_hermes.routing._mtd_cost_cents", return_value=0)
@patch("agenticos_hermes.routing._budget_cap_cents", return_value=3000)
def test_inbox_triage_routes_slm(_cap, _mtd):
    d = route(kind="inbox-triage", complexity="auto", context_tokens=500)
    assert d.provider == "ollama"


@patch("agenticos_hermes.routing._mtd_cost_cents", return_value=0)
@patch("agenticos_hermes.routing._budget_cap_cents", return_value=3000)
def test_daily_brief_routes_codex(_cap, _mtd):
    d = route(kind="daily-brief", complexity="auto", context_tokens=2000)
    assert d.provider == "openai"


@patch("agenticos_hermes.routing._mtd_cost_cents", return_value=0)
@patch("agenticos_hermes.routing._budget_cap_cents", return_value=3000)
def test_long_context_forces_codex(_cap, _mtd):
    d = route(kind="other", complexity="auto", context_tokens=17000)
    assert d.provider == "openai"


@patch("agenticos_hermes.routing._mtd_cost_cents", return_value=0)
@patch("agenticos_hermes.routing._budget_cap_cents", return_value=3000)
def test_default_routes_slm(_cap, _mtd):
    d = route(kind="other", complexity="auto", context_tokens=500)
    assert d.provider == "ollama"
