import { NextResponse } from "next/server";
import { getPool } from "@/lib/cost/db";

export const runtime = "nodejs";

/**
 * Aggregate counts powering the four KPI tiles on the Runs vista.
 * One round-trip — all aggregations fold into a single query so the
 * tiles render in lockstep.
 *
 *   - activeCount       : currently running tasks
 *   - failedToday       : terminal-failed tasks since local midnight UTC
 *   - avgDurationSec    : avg (ended_at - started_at) over completed
 *                         tasks in the last 24h. `null` when none.
 *   - activeKinds       : kind labels of the currently-running tasks,
 *                         deduped & comma-joined for the sublabel.
 */
export interface RunsStats {
  activeCount: number;
  failedToday: number;
  avgDurationSec: number | null;
  activeKinds: string[];
}

interface StatsRow {
  active_count: string;
  failed_today: string;
  avg_duration_sec: string | null;
  active_kinds: string[] | null;
}

export async function GET(): Promise<Response> {
  const pool = getPool();
  const { rows } = await pool.query<StatsRow>(`
    SELECT
      (SELECT COUNT(*) FROM tasks WHERE status = 'running')::text
        AS active_count,
      (SELECT COUNT(*) FROM tasks
         WHERE status = 'failed'
           AND ended_at >= date_trunc('day', NOW()))::text
        AS failed_today,
      (SELECT EXTRACT(EPOCH FROM AVG(ended_at - started_at))::numeric(10,1)
         FROM tasks
         WHERE status = 'done'
           AND ended_at IS NOT NULL
           AND ended_at >= NOW() - INTERVAL '24 hours')::text
        AS avg_duration_sec,
      (SELECT ARRAY_AGG(DISTINCT kind ORDER BY kind)
         FROM tasks WHERE status = 'running')
        AS active_kinds
  `);

  const r = rows[0];
  const stats: RunsStats = {
    activeCount: Number(r?.active_count ?? 0) || 0,
    failedToday: Number(r?.failed_today ?? 0) || 0,
    avgDurationSec:
      r?.avg_duration_sec == null ? null : Number(r.avg_duration_sec) || null,
    activeKinds: r?.active_kinds ?? [],
  };

  return NextResponse.json(stats);
}
