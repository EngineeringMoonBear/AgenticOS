import { NextResponse } from "next/server";
import { readRateLimits } from "@/lib/limits/reader";
import type { RateLimitsResponse } from "@/lib/limits/types";

export async function GET() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const history = await readRateLimits(since);
    const latest = history[history.length - 1];
    const response: RateLimitsResponse = {
      current: latest
        ? {
            requests:  { limit: latest.limitRequests, remaining: latest.remainingRequests, resetAt: latest.resetRequestsAt },
            tokens:    { limit: latest.limitTokens,   remaining: latest.remainingTokens,   resetAt: latest.resetTokensAt },
            sampledAt: latest.ts,
          }
        : null,
      history,
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("/api/limits failed:", err);
    return NextResponse.json({ error: "Failed to read rate limits" }, { status: 500 });
  }
}
