import "server-only";
import type { ProjectionResult } from "./types";

export function willNextRunFit(state: {
  requests: { limit: number; remaining: number; resetAt: string };
  tokens:   { limit: number; remaining: number; resetAt: string };
}): ProjectionResult {
  const tokenFraction = state.tokens.remaining / state.tokens.limit;
  if (tokenFraction < 0.05) {
    return { fits: false, reason: `tokens at ${(tokenFraction * 100).toFixed(0)}%` };
  }
  const reqFraction = state.requests.remaining / state.requests.limit;
  if (reqFraction < 0.05) {
    return { fits: false, reason: `requests at ${(reqFraction * 100).toFixed(0)}%` };
  }
  return { fits: true, reason: "headroom available" };
}
