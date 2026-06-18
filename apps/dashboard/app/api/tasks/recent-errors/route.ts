import { NextResponse } from "next/server";
import { getPool } from "@/lib/cost/db";
import { dataSource } from "@/lib/config/data-source";
import type { HeartbeatRun } from "@/lib/paperclip/client";

export const runtime = "nodejs";

export interface RecentErrorRow {
  id: string;
  kind: string;
  error: string | null;
  started_at: string;
}

// Run statuses that represent a failure outcome.
// Source: vendor/paperclip/packages/shared/src/constants.ts:644
const FAILED_STATUSES = new Set(["failed", "timed_out"]);

// Liveness states that carry a meaningful failure reason in livenessReason.
// Source: vendor/paperclip/packages/shared/src/constants.ts:655
const FAILURE_LIVENESS_STATES = new Set(["failed"]);

// ---------------------------------------------------------------------------
// Paperclip branch
// ---------------------------------------------------------------------------

async function getPaperclipErrors(): Promise<Response> {
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

  const result = await client.heartbeatRuns({ limit: 20 });

  if (!result.ok) {
    return NextResponse.json(
      { error: `Paperclip heartbeatRuns failed: ${result.error}` },
      { status: 503 },
    );
  }

  const rows: RecentErrorRow[] = (result.data as HeartbeatRun[])
    .filter((run) => FAILED_STATUSES.has(run.status))
    .map((run) => ({
      id: run.id,
      // kind ← invocationSource (per shared mapping decision across B-tasks).
      kind: run.invocationSource,
      // error ← run.error (PRIMARY: per-run text written on failure paths).
      // Fallback to livenessReason when livenessState denotes a failure and run.error is absent.
      // Source: vendor/paperclip/server/src/db/schema/heartbeat_runs.ts (error text column),
      //         heartbeatRunListColumns at vendor/paperclip/server/src/services/heartbeat.ts:1116
      error:
        run.error !== null && run.error !== undefined
          ? run.error
          : run.livenessState !== null &&
              FAILURE_LIVENESS_STATES.has(run.livenessState) &&
              run.livenessReason !== null
            ? run.livenessReason
            : null,
      started_at: run.startedAt ?? run.createdAt,
    }));

  return NextResponse.json({ rows });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<Response> {
  if (dataSource() === "paperclip") {
    return getPaperclipErrors();
  }

  // ── Existing Hermes logic (unchanged) ────────────────────────────────────
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
