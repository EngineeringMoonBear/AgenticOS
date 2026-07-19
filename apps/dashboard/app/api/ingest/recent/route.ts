import { NextResponse } from "next/server";
import { getPool } from "@/lib/cost/db";
import { REGISTERED_CRONS } from "@/lib/scheduler/registered-crons";

export const runtime = "nodejs";

/**
 * Recent vault-ingest runs for the Vault-ingest panel (truth pass
 * 2026-07-14; previously returned three canned runs).
 *
 * Real sources:
 *   - Postgres `tasks` rows WHERE kind='vault-ingest' — the same telemetry
 *     the old /api/ingest/status route read (that route folded into this one).
 *   - REGISTERED_CRONS for the vault-ingest cron expression shown in the
 *     panel header (dashboard mirror of infra/scripts/register-cron-jobs.sh).
 */

export interface IngestRun {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  error: string | null;
  metadata: Record<string, unknown> | null;
}

export interface IngestRecentData {
  /** Cron expression of the registered vault-ingest job; null if unregistered. */
  schedule: string | null;
  runs: IngestRun[];
}

export async function GET(): Promise<Response> {
  const pool = getPool();
  const { rows } = await pool.query<IngestRun>(
    `SELECT id,
            started_at::text AS started_at,
            ended_at::text AS ended_at,
            status,
            error,
            metadata
     FROM tasks
     WHERE kind = 'vault-ingest'
     ORDER BY started_at DESC
     LIMIT 10`,
  );

  const schedule =
    REGISTERED_CRONS.find((c) => c.name === "vault-ingest")?.schedule ?? null;

  const data: IngestRecentData = { schedule, runs: rows };
  return NextResponse.json(data);
}
