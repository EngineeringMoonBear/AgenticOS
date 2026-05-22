"""slm_router — decides Codex vs Ollama per call.

Decision tree (spec §5.1, priority order):
  1. Budget hard-block      → SLM
  2. Task-kind override     → config-driven
  3. Context > 16k tokens   → Codex (SLMs lose coherence)
  4. Complexity hint        → high → Codex, low → SLM
  5. Default                → SLM
"""
from dataclasses import dataclass
from typing import Literal

from .db import connect

CONTEXT_ESCALATION_THRESHOLD = 16_000
DEFAULT_SLM_MODEL = "qwen2.5:3b"
DEFAULT_CODEX_MODEL = "gpt-5-codex"

_KIND_ROUTING: dict[str, str] = {
    "inbox-triage": "ollama",
    "cost-report": "ollama",
    "daily-brief": "openai",
}


@dataclass(frozen=True)
class RouteDecision:
    provider: Literal["ollama", "openai"]
    model: str
    reason: str
    budget_blocked: bool = False


def _mtd_cost_cents() -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("""SELECT COALESCE(SUM(cost_cents), 0)
                       FROM calls
                       WHERE provider = 'openai'
                         AND occurred_at >= date_trunc('month', now())""")
        return int(cur.fetchone()[0])


def _budget_cap_cents() -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT monthly_cap_cents FROM budget WHERE id = 1")
        row = cur.fetchone()
        return int(row[0]) if row else 3000


def route(*, kind: str,
          complexity: Literal["low", "auto", "high"] = "auto",
          context_tokens: int = 0) -> RouteDecision:
    if _mtd_cost_cents() >= _budget_cap_cents():
        return RouteDecision("ollama", DEFAULT_SLM_MODEL,
                             "budget-blocked", budget_blocked=True)
    if kind in _KIND_ROUTING:
        prov = _KIND_ROUTING[kind]
        model = DEFAULT_CODEX_MODEL if prov == "openai" else DEFAULT_SLM_MODEL
        return RouteDecision(prov, model, f"kind-override:{kind}")
    if context_tokens > CONTEXT_ESCALATION_THRESHOLD:
        return RouteDecision("openai", DEFAULT_CODEX_MODEL,
                             f"context-{context_tokens}>16k")
    if complexity == "high":
        return RouteDecision("openai", DEFAULT_CODEX_MODEL, "complexity-high")
    if complexity == "low":
        return RouteDecision("ollama", DEFAULT_SLM_MODEL, "complexity-low")
    return RouteDecision("ollama", DEFAULT_SLM_MODEL, "default-slm")
