import { NextResponse } from "next/server";
import { getPool } from "@/lib/cost/db";

export const runtime = "nodejs";

export interface QueueDepthRow {
  kind: string;
  status: string;
  count: number;
}

export async function GET(): Promise<Response> {
  const pool = getPool();
  const [{ rows }, asOf] = await Promise.all([
    pool.query<QueueDepthRow>(`
      SELECT kind, status, COUNT(*)::int AS count
      FROM tasks
      WHERE status IN ('queued', 'running')
      GROUP BY kind, status
      ORDER BY kind, status
    `),
    // Point-in-time reconstruction: how many tasks were in-flight one hour ago,
    // derived from started_at/ended_at (no sample-history table needed). A task
    // was in-flight at time T if it had started by T and had not yet ended.
    pool.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count
      FROM tasks
      WHERE started_at <= now() - interval '1 hour'
        AND (ended_at IS NULL OR ended_at > now() - interval '1 hour')
    `),
  ]);
  const asOf1hCount = asOf.rows[0]?.count ?? 0;
  return NextResponse.json({ rows, asOf1hCount });
}
