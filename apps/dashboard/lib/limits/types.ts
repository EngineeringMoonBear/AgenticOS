import "server-only";

export interface RateLimitSample {
  ts:                  string;
  runId:               string;
  limitRequests:       number;
  remainingRequests:   number;
  resetRequestsAt:     string;
  limitTokens:         number;
  remainingTokens:     number;
  resetTokensAt:       string;
  retryAfter?:         number;
}

export interface RateLimitsResponse {
  current: {
    requests:  { limit: number; remaining: number; resetAt: string };
    tokens:    { limit: number; remaining: number; resetAt: string };
    sampledAt: string;
  } | null;
  history: RateLimitSample[];
}

export interface ProjectionResult {
  fits:    boolean;
  reason:  string;
}
