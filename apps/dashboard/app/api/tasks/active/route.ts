import { NextResponse } from "next/server";
import { getPool } from "@/lib/cost/db";

export const runtime = "nodejs";

export interface ActiveRun {
  id: string;
  kind: string;
  started_at: string;
  elapsed_seconds: number;
  stuck: boolean;
}

interface ActiveRunRow {
  id: string;
  kind: string;
  started_at: string;
  elapsed_seconds: string | number;
  heartbeat_age_seconds: string | number | null;
}

const STUCK_ELAPSED_THRESHOLD = 300; // 5 minutes total runtime
const STUCK_HEARTBEAT_THRESHOLD = 60; // no heartbeat for 60s
const STUCK_HEARTBEAT_MIN_AGE = 60; // only consider after first 60s

export async function GET(): Promise<Response> {
  const pool = getPool();
  // heartbeat_at column may not exist on older schemas; fall back gracefully.
  let rows: ActiveRunRow[];
  try {
    const result = await pool.query<ActiveRunRow>(`
      SELECT
        id,
        kind,
        started_at::text AS started_at,
        EXTRACT(EPOCH FROM (NOW() - started_at))::int AS elapsed_seconds,
        CASE
          WHEN heartbeat_at IS NULL THEN NULL
          ELSE EXTRACT(EPOCH FROM (NOW() - heartbeat_at))::int
        END AS heartbeat_age_seconds
      FROM tasks
      WHERE status = 'running'
      ORDER BY started_at ASC
    `);
    rows = result.rows;
  } catch {
    const result = await pool.query<ActiveRunRow>(`
      SELECT
        id,
        kind,
        started_at::text AS started_at,
        EXTRACT(EPOCH FROM (NOW() - started_at))::int AS elapsed_seconds,
        NULL::int AS heartbeat_age_seconds
      FROM tasks
      WHERE status = 'running'
      ORDER BY started_at ASC
    `);
    rows = result.rows;
  }

  const runs: ActiveRun[] = rows.map((r) => {
    const elapsed = Number(r.elapsed_seconds) || 0;
    const heartbeatAge =
      r.heartbeat_age_seconds == null ? null : Number(r.heartbeat_age_seconds);
    const stuckByElapsed = elapsed > STUCK_ELAPSED_THRESHOLD;
    const stuckByHeartbeat =
      elapsed > STUCK_HEARTBEAT_MIN_AGE &&
      heartbeatAge != null &&
      heartbeatAge > STUCK_HEARTBEAT_THRESHOLD;
    return {
      id: r.id,
      kind: r.kind,
      started_at: r.started_at,
      elapsed_seconds: elapsed,
      stuck: stuckByElapsed || stuckByHeartbeat,
    };
  });

  return NextResponse.json({ runs });
}
