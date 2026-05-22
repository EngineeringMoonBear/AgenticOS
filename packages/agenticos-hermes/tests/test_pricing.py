from agenticos_hermes.pricing import cost_cents

def test_local_ollama_is_free():
    assert cost_cents(provider="ollama", model="qwen2.5:3b",
                      input_tokens=1000, cached_input_tokens=0,
                      output_tokens=500, reasoning_output_tokens=0) == 0

def test_gpt5_codex_with_cache_discount():
    # 11754 input (10624 cached, 1130 uncached), 6 output, 0 reasoning — matches the verified probe
    # Expected: ~1.3 cents with cache discount, ~13 cents without
    c = cost_cents(provider="openai", model="gpt-5-codex",
                   input_tokens=11754, cached_input_tokens=10624,
                   output_tokens=6, reasoning_output_tokens=0)
    assert 1 <= c <= 3, f"expected ~1-2 cents with cache, got {c}"

def test_reasoning_tokens_billed_as_output():
    # If model has reasoning tokens (o-series), they count toward output rate.
    # NOTE: token counts scaled up vs. the plan draft so the cents delta
    # exceeds ceiling-rounding granularity (1¢ per 1/output_rate of 1M tokens).
    c_with_reasoning = cost_cents(provider="openai", model="gpt-5",
                                   input_tokens=100_000, cached_input_tokens=0,
                                   output_tokens=50_000, reasoning_output_tokens=200_000)
    c_without = cost_cents(provider="openai", model="gpt-5",
                            input_tokens=100_000, cached_input_tokens=0,
                            output_tokens=50_000, reasoning_output_tokens=0)
    assert c_with_reasoning > c_without
