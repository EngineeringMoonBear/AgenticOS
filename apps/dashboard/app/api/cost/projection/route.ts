import { NextResponse } from "next/server";

// TODO: derive from real spend history + cap config.

export const runtime = "nodejs";

export interface CostProjectionData {
  spend_usd: number;
  cap_usd: number;
  mtd_spend_usd: number;
  avg_per_day_usd: number;
  days_remaining: number;
}

export async function GET(): Promise<Response> {
  const data: CostProjectionData = {
    spend_usd: 47.74,
    cap_usd: 200,
    mtd_spend_usd: 46.18,
    avg_per_day_usd: 1.54,
    days_remaining: 3,
  };
  return NextResponse.json(data);
}
