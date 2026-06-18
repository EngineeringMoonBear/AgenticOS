import { NextResponse } from "next/server";
import { getPool } from "@/lib/cost/db";
import { dataSource } from "@/lib/config/data-source";
import type { HeartbeatRun } from "@/lib/paperclip/client";

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

// Live Paperclip statuses — queued and running are both "in flight".
// Source: vendor/paperclip/packages/shared/src/constants.ts:644
const LIVE_STATUSES = new Set(["queued", "running"]);

// ---------------------------------------------------------------------------
// Paperclip branch
// ---------------------------------------------------------------------------

async function getPaperclipActive(): Promise<Response> {
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

  const result = await client.heartbeatRuns({ limit: 200 });

  if (!result.ok) {
    return NextResponse.json(
      { error: `Paperclip heartbeatRuns failed: ${result.error}` },
      { status: 503 },
    );
  }

  const now = Date.now();

  const runs: ActiveRun[] = (result.data as HeartbeatRun[])
    .filter((run) => LIVE_STATUSES.has(run.status))
    .map((run) => {
      const startedAt = run.startedAt ?? run.createdAt;
      const elapsedMs = now - new Date(startedAt).getTime();
      const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));

      // Paperclip has no heartbeat_at field on heartbeat-run rows; stuck is
      // determined by elapsed time only (same logic as Hermes fallback query).
      const stuck = elapsedSec > STUCK_ELAPSED_THRESHOLD;

      return {
        id: run.id,
        // kind ← invocationSource (per shared mapping decision in task brief).
        kind: run.invocationSource,
        started_at: startedAt,
        elapsed_seconds: elapsedSec,
        stuck,
      };
    })
    // Sort by started_at ASC, matching Hermes SQL ORDER BY started_at ASC.
    .sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0));

  return NextResponse.json({ runs });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<Response> {
  if (dataSource() === "paperclip") {
    return getPaperclipActive();
  }

  // ── Existing Hermes logic (unchanged) ────────────────────────────────────
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
