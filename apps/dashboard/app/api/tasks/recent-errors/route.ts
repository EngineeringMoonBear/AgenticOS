import { NextResponse } from "next/server";
import { getPool } from "@/lib/cost/db";

export const runtime = "nodejs";

export interface RecentErrorRow {
  id: string;
  kind: string;
  error: string | null;
  started_at: string;
}

export async function GET(): Promise<Response> {
  const pool = getPool();
  const { rows } = await pool.query<RecentErrorRow>(`
    SELECT id, kind, error, started_at::text AS started_at
    FROM tasks
    WHERE status = 'failed'
    ORDER BY started_at DESC
    LIMIT 20
  `);
  return NextResponse.json({ rows });
}
