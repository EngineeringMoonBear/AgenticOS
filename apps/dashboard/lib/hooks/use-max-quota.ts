"use client";
import { useQuery } from "@tanstack/react-query";

/**
 * `/api/limits` returns Anthropic-style rate-limit windows (requests + tokens
 * remaining / limit / resetAt). No dedicated `/api/limits/max` route exists in
 * Spec 1 — we adapt by surfacing the tokens-remaining percentage from the
 * existing rate-limit endpoint. If `current` is null (no samples yet), the
 * chip renders a stable "Max: —" fallback.
 */
export interface MaxQuota {
  remaining_pct: number | null;
  remaining_tokens: number | null;
  limit_tokens: number | null;
  reset_at: string | null;
}

interface LimitsApiResponse {
  current: {
    requests: { limit: number; remaining: number; resetAt: string };
    tokens: { limit: number; remaining: number; resetAt: string };
    sampledAt: string;
  } | null;
}

export function useMaxQuota() {
  return useQuery<MaxQuota>({
    queryKey: ["max-quota"],
    queryFn: async () => {
      const r = await fetch("/api/limits");
      if (!r.ok) throw new Error(`max quota HTTP ${r.status}`);
      const data = (await r.json()) as LimitsApiResponse;
      if (!data.current) {
        return { remaining_pct: null, remaining_tokens: null, limit_tokens: null, reset_at: null };
      }
      const { tokens } = data.current;
      const pct = tokens.limit > 0 ? Math.round((100 * tokens.remaining) / tokens.limit) : null;
      return {
        remaining_pct: pct,
        remaining_tokens: tokens.remaining,
        limit_tokens: tokens.limit,
        reset_at: tokens.resetAt,
      };
    },
    refetchInterval: 30_000,
  });
}
