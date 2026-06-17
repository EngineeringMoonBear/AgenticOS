/**
 * GET /api/runs?limit=<n>
 *
 * Paperclip-backed runs feed endpoint. This is an ADDITIVE route —
 * it does not replace the existing Hermes-backed /api/agent/runs route.
 * Wiring of dashboard consumers happens in a later task behind a feature flag.
 *
 * Response shape:
 *   {
 *     runs: RunRecord[],   // all runs mapped from Paperclip heartbeat-runs
 *     live: RunRecord[],   // subset where status is "queued" or "running"
 *   }
 *
 * Each HeartbeatRun is mapped to the RunRecord shape consumed by:
 *   - components/observability/run-feed.tsx
 *   - components/observability/live-runs-strip.tsx
 *   - components/runs/run-card.tsx
 *
 * Shape gap vs task brief: brief specifies {id, kind, status, startedAt,
 * endedAt, costCents?} but the real consumers use RunRecord which has
 * {agent, costUsd, inputTokens, outputTokens, ...} — we match the real
 * consumers. See task-1.3-report.md for full details.
 *
 * On any upstream failure → 503 { error: string }
 * On missing env config   → 503 { error: string }
 */

import { NextResponse } from "next/server";
import { createPaperclipClient } from "@/lib/paperclip/client";
import type { HeartbeatRun } from "@/lib/paperclip/client";

export const runtime = "nodejs";

const LIVE_STATUSES = new Set(["queued", "running"]);

/**
 * Maps a Paperclip HeartbeatRun to the RunRecord shape that dashboard
 * consumers (run-feed, live-runs-strip, run-card) render.
 *
 * Fields that have no direct equivalent in HeartbeatRun (inputTokens,
 * outputTokens, toolCalls, etc.) are zeroed — Paperclip only carries
 * cost totals and liveness state, not per-call token counts.
 */
function mapToRunRecord(run: HeartbeatRun) {
  // costCents may be embedded in resultJson by the Paperclip agent adapter.
  const costCents =
    run.resultJson != null &&
    typeof run.resultJson["costCents"] === "number"
      ? (run.resultJson["costCents"] as number)
      : 0;

  return {
    id: run.id,
    // agentId is the closest equivalent to `agent` (display name not available
    // in heartbeat payload without a separate agents lookup).
    agent: run.agentId,
    status: run.status,
    startedAt: run.startedAt ?? run.createdAt,
    endedAt: run.finishedAt,
    costUsd: costCents / 100,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    toolCalls: 0,
    errorMessage: null as string | null,
  };
}

export async function GET(req: Request): Promise<Response> {
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

  const client = createPaperclipClient({ apiUrl, boardKey, companyId });

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : 50;

  const result = await client.heartbeatRuns({ limit });

  if (!result.ok) {
    return NextResponse.json(
      { error: `Paperclip heartbeatRuns failed: ${result.error}` },
      { status: 503 },
    );
  }

  const runs = result.data.map(mapToRunRecord);
  const live = runs.filter((r) => LIVE_STATUSES.has(r.status));

  return NextResponse.json({ runs, live });
}
