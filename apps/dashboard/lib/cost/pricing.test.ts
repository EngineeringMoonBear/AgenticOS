import { describe, it, expect } from "vitest";
import { computeCostCents } from "./pricing";

describe("computeCostCents", () => {
  it("returns 0 for Ollama (local)", () => {
    expect(
      computeCostCents({
        provider: "ollama",
        model: "qwen2.5:3b",
        input_tokens: 1000,
        output_tokens: 500,
      }),
    ).toBe(0);
  });

  it("computes gpt-5-codex cost from token counts", () => {
    // 1000 input * 125 + 500 output * 1000 = 125_000 + 500_000 = 625_000 micro-cents → ceil(0.625) = 1
    const c = computeCostCents({
      provider: "openai",
      model: "gpt-5-codex",
      input_tokens: 1000,
      output_tokens: 500,
    });
    expect(c).toBeGreaterThanOrEqual(1);
  });

  it("throws on unknown model", () => {
    expect(() =>
      computeCostCents({
        provider: "openai",
        model: "bogus",
        input_tokens: 100,
        output_tokens: 100,
      }),
    ).toThrow();
  });

  it("throws on unknown provider", () => {
    expect(() =>
      computeCostCents({
        // @ts-expect-error testing runtime guard
        provider: "anthropic",
        model: "claude-opus-4",
        input_tokens: 100,
        output_tokens: 100,
      }),
    ).toThrow();
  });

  it("discounts cached input tokens", () => {
    // gpt-5: input 300/M, cached 30/M, output 1500/M
    // 1M input all uncached, 0 output → 300 cents
    const full = computeCostCents({
      provider: "openai",
      model: "gpt-5",
      input_tokens: 1_000_000,
      output_tokens: 0,
    });
    // Same call, but all input cached → 30 cents
    const cached = computeCostCents({
      provider: "openai",
      model: "gpt-5",
      input_tokens: 1_000_000,
      output_tokens: 0,
      cached_input_tokens: 1_000_000,
    });
    expect(full).toBe(300);
    expect(cached).toBe(30);
  });

  it("bills reasoning_output_tokens at the output rate", () => {
    // gpt-5-mini: output 60/M
    // 0 regular output + 1M reasoning → 60 cents
    const c = computeCostCents({
      provider: "openai",
      model: "gpt-5-mini",
      input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 1_000_000,
    });
    expect(c).toBe(60);
  });

  it("ceiling-rounds fractional cents", () => {
    // 1 input token on gpt-5-codex → 125 / 1_000_000 → ceil = 1
    const c = computeCostCents({
      provider: "openai",
      model: "gpt-5-codex",
      input_tokens: 1,
      output_tokens: 0,
    });
    expect(c).toBe(1);
  });
});
