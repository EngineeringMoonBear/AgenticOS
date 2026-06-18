import { NextResponse } from "next/server";
import { getPool } from "@/lib/cost/db";
import { dataSource } from "@/lib/config/data-source";
import type { HeartbeatRun } from "@/lib/paperclip/client";

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

// ---------------------------------------------------------------------------
// Paperclip → chart status mapping
// Paperclip statuses (constants.ts:644):
//   "queued"|"scheduled_retry"|"running"|"succeeded"|"failed"|"cancelled"|"timed_out"
// Chart vocabulary: "running" | "done" | "failed"
// queued and scheduled_retry are excluded (not yet active from the chart's pov)
// ---------------------------------------------------------------------------

type ChartStatus = "running" | "done" | "failed";

function mapChartStatus(status: string): ChartStatus | null {
  switch (status) {
    case "running":
      return "running";
    case "succeeded":
    case "cancelled":
      return "done";
    case "failed":
    case "timed_out":
      return "failed";
    // queued and scheduled_retry: excluded from the chart
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Paperclip branch
// ---------------------------------------------------------------------------

async function getPaperclipRecentEvents(windowMin: number): Promise<Response> {
  const apiUrl = process.env.PAPERCLIP_API_URL;
  const boardKey = process.env.PAPERCLIP_BOARD_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!apiUrl || !boardKey || !companyId) {
    return NextResponse.json(
      {
        error:
          "Paperclip is not configured. Set PAPERCLIP_API_URL, PAPERCLIP_BOARD_KEY, and PAPERCLIP_COMPANY_ID.",
      },
      { status: 503 },
    );
  }

  const { createPaperclipClient } = await import("@/lib/paperclip/client");
  const client = createPaperclipClient({ apiUrl, boardKey, companyId });

  const result = await client.heartbeatRuns({ limit: 500 });

  if (!result.ok) {
    return NextResponse.json(
      { error: `Paperclip heartbeatRuns failed: ${result.error}` },
      { status: 503 },
    );
  }

  // Window filter: only include runs whose `at` timestamp falls within the window.
  const cutoff = new Date(Date.now() - windowMin * 60 * 1000).toISOString();

  const events: RecentRunEvent[] = [];
  for (const run of result.data as HeartbeatRun[]) {
    const chartStatus = mapChartStatus(run.status);
    if (chartStatus === null) continue; // skip queued/scheduled_retry

    // `at` mirrors the Hermes SQL CASE: running → startedAt, terminal → finishedAt
    const at =
      run.status === "running"
        ? (run.startedAt ?? run.createdAt)
        : (run.finishedAt ?? run.startedAt ?? run.createdAt);

    if (at < cutoff) continue; // outside the window

    events.push({
      id: run.id,
      status: chartStatus,
      kind: run.invocationSource,
      at,
    });
  }

  // Sort ascending by at (matches Hermes SQL ORDER BY at ASC).
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return NextResponse.json({ events, windowMin });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const rawWindow = Number(sp.get("windowMin") ?? `${DEFAULT_WINDOW_MIN}`);
  const windowMin =
    Number.isFinite(rawWindow) && rawWindow > 0
      ? Math.min(rawWindow, MAX_WINDOW_MIN)
      : DEFAULT_WINDOW_MIN;

  if (dataSource() === "paperclip") {
    return getPaperclipRecentEvents(windowMin);
  }

  // ── Existing Hermes logic (unchanged) ────────────────────────────────────
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
