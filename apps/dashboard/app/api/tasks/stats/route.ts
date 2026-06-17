import { NextResponse } from "next/server";
import { getPool } from "@/lib/cost/db";
import { dataSource } from "@/lib/config/data-source";
import type { HeartbeatRun } from "@/lib/paperclip/client";

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

// ---------------------------------------------------------------------------
// Paperclip branch
// ---------------------------------------------------------------------------

async function getPaperclipStats(): Promise<Response> {
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

  const runs = result.data as HeartbeatRun[];
  const now = Date.now();
  const todayMidnightUtc = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );

  let activeCount = 0;
  let failedToday = 0;
  let totalDurationMs = 0;
  let durationCount = 0;
  const activeKindSet = new Set<string>();

  for (const run of runs) {
    const isActive = run.status === "running" || run.status === "queued";
    const isFailed = run.status === "failed" || run.status === "timed_out";

    if (isActive) {
      activeCount++;
      activeKindSet.add(run.invocationSource);
    }

    if (isFailed) {
      // Check if the failure happened since UTC midnight today.
      const failedAt = run.finishedAt ?? run.startedAt ?? run.createdAt;
      if (new Date(failedAt).getTime() >= todayMidnightUtc) {
        failedToday++;
      }
    }

    // avgDurationSec: only succeeded runs with both timestamps in the last 24h.
    // Mirrors Hermes SQL: status='done' AND ended_at >= NOW() - INTERVAL '24 hours'
    if (run.status === "succeeded" && run.startedAt && run.finishedAt) {
      const start = new Date(run.startedAt).getTime();
      const end = new Date(run.finishedAt).getTime();
      if (!isNaN(start) && !isNaN(end) && end >= now - 24 * 60 * 60 * 1000) {
        totalDurationMs += end - start;
        durationCount++;
      }
    }
  }

  const avgDurationSec =
    durationCount > 0
      ? Math.round((totalDurationMs / durationCount / 1000) * 10) / 10
      : null;

  // activeKinds: sorted distinct invocationSource values of currently-running runs.
  // (Paperclip invocationSource plays the role of Hermes task `kind` here.)
  const activeKinds = Array.from(activeKindSet).sort();

  const stats: RunsStats = {
    activeCount,
    failedToday,
    avgDurationSec,
    activeKinds,
  };

  return NextResponse.json(stats);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<Response> {
  if (dataSource() === "paperclip") {
    return getPaperclipStats();
  }

  // ── Existing Hermes logic (unchanged) ────────────────────────────────────
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
