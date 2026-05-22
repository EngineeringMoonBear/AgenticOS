"""Per-call cost computation. Source of truth for $ amounts in telemetry.

Pricing tables are checked into version control — commit history acts as the
audit trail. Update whenever OpenAI changes their rate card.

Schema: per million tokens, in cents. Tuple is (input_rate, cached_rate, output_rate).
Cached input is heavily discounted (~90% off) per OpenAI's prompt-cache pricing.
"""
from typing import Final, Literal

# (input_per_M_cents, cached_input_per_M_cents, output_per_M_cents)
_OPENAI_PRICING: Final[dict[str, tuple[int, int, int]]] = {
    # Verify against https://openai.com/api/pricing — last reviewed 2026-05-22
    "gpt-5-codex": (125, 12, 1000),    # $1.25 / $0.12 / $10.00
    "gpt-5":       (300, 30, 1500),    # $3.00 / $0.30 / $15.00
    "gpt-5-mini":  (15,  1,  60),      # $0.15 / $0.01 / $0.60
    "gpt-4o-mini": (15,  1,  60),
}

_LOCAL_PROVIDERS: Final[set[str]] = {"ollama"}


def cost_cents(*,
               provider: Literal["openai", "ollama"],
               model: str,
               input_tokens: int,
               cached_input_tokens: int = 0,
               output_tokens: int,
               reasoning_output_tokens: int = 0) -> int:
    """Compute cost in integer cents (ceiling-rounded).

    Reasoning tokens (o-series "thinking") are billed at the output rate.
    Cached input tokens are billed at the cached (discounted) rate; the
    remaining `input_tokens - cached_input_tokens` are billed at full input rate.
    """
    if provider in _LOCAL_PROVIDERS:
        return 0
    if provider != "openai":
        raise ValueError(f"unknown provider: {provider}")
    if model not in _OPENAI_PRICING:
        raise ValueError(f"unknown model: {model}")

    in_rate, cached_rate, out_rate = _OPENAI_PRICING[model]
    uncached_input = max(0, input_tokens - cached_input_tokens)
    total_output = output_tokens + reasoning_output_tokens

    # Cents-per-million tokens * tokens → integer cents (ceiling)
    micro = (uncached_input * in_rate
             + cached_input_tokens * cached_rate
             + total_output * out_rate)
    return -(-micro // 1_000_000)  # ceiling division
