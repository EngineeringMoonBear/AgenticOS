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
  const { rows } = await pool.query<QueueDepthRow>(`
    SELECT kind, status, COUNT(*)::int AS count
    FROM tasks
    WHERE status IN ('queued', 'running')
    GROUP BY kind, status
    ORDER BY kind, status
  `);
  return NextResponse.json({ rows });
}
