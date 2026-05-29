import { NextResponse } from "next/server";

// TODO: wire to real upstream rate-limit telemetry (OpenAI usage headers).

export const runtime = "nodejs";

export type RateLimitVariant = "pine" | "amber" | "gold";

export interface RateLimitLine {
  name: string;
  used: number;
  cap: number;
  detail: string;
  variant: RateLimitVariant;
}

export interface RateLimitsData {
  provider: string;
  resets_label: string;
  lines: RateLimitLine[];
}

export async function GET(): Promise<Response> {
  const data: RateLimitsData = {
    provider: "openai",
    resets_label: "resets 14:42",
    lines: [
      {
        name: "Tokens / minute",
        used: 73420,
        cap: 100000,
        detail: "73,420 / 100,000",
        variant: "amber",
      },
      {
        name: "Requests / minute",
        used: 12,
        cap: 100,
        detail: "12 / 100",
        variant: "pine",
      },
    ],
  };
  return NextResponse.json(data);
}
