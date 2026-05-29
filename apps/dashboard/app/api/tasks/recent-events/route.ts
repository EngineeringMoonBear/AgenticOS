import { NextResponse } from "next/server";
import { getPool } from "@/lib/cost/db";

export const runtime = "nodejs";

/**
 * Event shape feeding the Runs vista's ActivityStripBackdrop chart.
 * Mirrors `ActivityStripEvent` in components/shell/backdrops/ActivityStripBackdrop.tsx
 * exactly — the route's job is to produce data in the chart's contract.
 *
 * `at` is the moment the event should be plotted at on the time axis:
 *   - `done` / `failed` use `ended_at` (when the run resolved)
 *   - `running` uses `started_at` (still in flight)
 *
 * `queued` and `budget-blocked` tasks are intentionally excluded — the
 * chart's vocabulary only has three colors. Queued runs become visible
 * once they transition to running.
 */
export interface RecentRunEvent {
  at: string;
  status: "running" | "done" | "failed";
  kind: string;
  id: string;
}

interface Row {
  id: string;
  kind: string;
  status: "running" | "done" | "failed";
  at: string;
}

const DEFAULT_WINDOW_MIN = 60;
const MAX_WINDOW_MIN = 24 * 60; // 24h ceiling — protect the chart from absurd ranges

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const rawWindow = Number(sp.get("windowMin") ?? `${DEFAULT_WINDOW_MIN}`);
  const windowMin =
    Number.isFinite(rawWindow) && rawWindow > 0
      ? Math.min(rawWindow, MAX_WINDOW_MIN)
      : DEFAULT_WINDOW_MIN;

  const pool = getPool();
  const { rows } = await pool.query<Row>(
    `
    SELECT
      id,
      kind,
      status,
      CASE
        WHEN status = 'running' THEN started_at
        ELSE ended_at
      END::text AS at
    FROM tasks
    WHERE
      (status = 'running' AND started_at >= NOW() - ($1::int * INTERVAL '1 minute'))
      OR (status IN ('done', 'failed')
          AND ended_at IS NOT NULL
          AND ended_at >= NOW() - ($1::int * INTERVAL '1 minute'))
    ORDER BY at ASC
    LIMIT 500
    `,
    [windowMin],
  );

  const events: RecentRunEvent[] = rows.map((r) => ({
    at: r.at,
    status: r.status,
    kind: r.kind,
    id: r.id,
  }));

  return NextResponse.json({ events, windowMin });
}
