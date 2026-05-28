import { NextResponse } from "next/server";
import { getPool } from "@/lib/cost/db";

export const runtime = "nodejs";

export interface BurndownPoint {
  at: string;
  cents: number;
}

export type BurndownRange = "24h" | "30d";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rangeParam = url.searchParams.get("range");
  const range: BurndownRange = rangeParam === "30d" ? "30d" : "24h";

  const pool = getPool();
  const bucket = range === "30d" ? "day" : "hour";
  const interval = range === "30d" ? "30 days" : "24 hours";

  const { rows } = await pool.query<{ at: string; cents: number }>(
    `
      SELECT date_trunc($1, occurred_at)::text AS at,
             COALESCE(SUM(cost_cents), 0)::int AS cents
      FROM calls
      WHERE occurred_at >= now() - ($2)::interval
      GROUP BY 1
      ORDER BY 1
    `,
    [bucket, interval],
  );

  return NextResponse.json({ range, bucket, points: rows });
}
