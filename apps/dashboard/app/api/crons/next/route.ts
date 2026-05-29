import "server-only";
import { NextResponse } from "next/server";
import { nextFire } from "@/lib/scheduler/cron-next";
import { REGISTERED_CRONS } from "@/lib/scheduler/registered-crons";

export const runtime = "nodejs";

/**
 * Soonest-upcoming Hermes cron entry. Feeds the Runs vista's
 * "Next scheduled" KPI tile.
 *
 *   {
 *     "name":      "vault-ingest",
 *     "schedule":  "0 * * * *",
 *     "nextRunAt": "2026-05-29T17:00:00.000Z",
 *     "etaSec":    1843
 *   }
 *
 * Returns null when no registered cron has a computable next-fire
 * within the lookahead window (only possible for an unsatisfiable
 * expression like `0 0 30 2 *`).
 */
export interface NextCronInfo {
  name: string;
  schedule: string;
  description: string;
  nextRunAt: string;
  etaSec: number;
}

export async function GET(): Promise<Response> {
  const now = new Date();
  const candidates = REGISTERED_CRONS
    .map((cron) => {
      const fire = nextFire(cron.schedule, now);
      return fire ? { cron, fire } : null;
    })
    .filter((v): v is { cron: typeof REGISTERED_CRONS[number]; fire: Date } => v !== null)
    .sort((a, b) => a.fire.getTime() - b.fire.getTime());

  if (candidates.length === 0) {
    return NextResponse.json(null);
  }

  const winner = candidates[0];
  const payload: NextCronInfo = {
    name: winner.cron.name,
    schedule: winner.cron.schedule,
    description: winner.cron.description,
    nextRunAt: winner.fire.toISOString(),
    etaSec: Math.max(0, Math.round((winner.fire.getTime() - now.getTime()) / 1000)),
  };

  return NextResponse.json(payload);
}
