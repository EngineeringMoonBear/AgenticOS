/**
 * Per-call cost computation for the dashboard.
 *
 * MUST stay in sync with packages/agenticos-hermes/src/agenticos_hermes/pricing.py.
 * The Python side is the source of truth at write-time (it writes the row in
 * `calls.cost_cents`). This TS copy is used for dashboard-side projections that
 * estimate cost without round-tripping to Postgres.
 *
 * Schema (per million tokens, in cents):
 *   [input_rate, cached_input_rate, output_rate]
 * Cached input tokens are billed at the discounted cached rate; the remaining
 * `input_tokens - cached_input_tokens` are billed at the full input rate.
 * Reasoning output tokens (o-series "thinking") are billed at the output rate.
 */

interface PricingArgs {
  provider: "openai" | "ollama";
  model: string;
  input_tokens: number;
  output_tokens: number;
  /** Optional — defaults to 0. Tokens served from OpenAI's prompt cache. */
  cached_input_tokens?: number;
  /** Optional — defaults to 0. o-series reasoning tokens, billed as output. */
  reasoning_output_tokens?: number;
}

// (input_per_M_cents, cached_input_per_M_cents, output_per_M_cents)
// KEEP IN SYNC WITH pricing.py. Verify against https://openai.com/api/pricing.
const OPENAI_PRICING: Record<string, [number, number, number]> = {
  "gpt-5-codex": [125, 12, 1000], // $1.25 / $0.12 / $10.00
  "gpt-5": [300, 30, 1500], //       $3.00 / $0.30 / $15.00
  "gpt-5-mini": [15, 1, 60], //      $0.15 / $0.01 / $0.60
  "gpt-4o-mini": [15, 1, 60],
};

const LOCAL_PROVIDERS = new Set(["ollama"]);

export function computeCostCents({
  provider,
  model,
  input_tokens,
  output_tokens,
  cached_input_tokens = 0,
  reasoning_output_tokens = 0,
}: PricingArgs): number {
  if (LOCAL_PROVIDERS.has(provider)) return 0;
  if (provider !== "openai") throw new Error(`unknown provider: ${provider}`);

  const pricing = OPENAI_PRICING[model];
  if (!pricing) throw new Error(`unknown model: ${model}`);
  const [inPerM, cachedPerM, outPerM] = pricing;

  const uncachedInput = Math.max(0, input_tokens - cached_input_tokens);
  const totalOutput = output_tokens + reasoning_output_tokens;

  const micro =
    uncachedInput * inPerM +
    cached_input_tokens * cachedPerM +
    totalOutput * outPerM;

  // Ceiling-divide micro-cents → cents (matches Python's `-(-micro // 1_000_000)`).
  return Math.ceil(micro / 1_000_000);
}
