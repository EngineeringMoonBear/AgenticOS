import "server-only";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { RunRecord } from "@/lib/agent";
import { dataSource } from "@/lib/config/data-source";
import type { HeartbeatRun } from "@/lib/paperclip/client";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Paperclip → RunRecord status mapping
// Source statuses from vendor/paperclip/packages/shared/src/constants.ts:644
// "queued"|"scheduled_retry"|"running"|"succeeded"|"failed"|"cancelled"|"timed_out"
// ---------------------------------------------------------------------------

function mapStatus(paperclipStatus: string): z.infer<typeof RunRecord>["status"] {
  switch (paperclipStatus) {
    case "running":
      return "running";
    case "queued":
    case "scheduled_retry":
      return "queued";
    case "succeeded":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "failed":
    case "timed_out":
    default:
      return "failed";
  }
}

/**
 * Maps a Paperclip HeartbeatRun to the RunRecord shape consumed by
 * lib/hooks/use-run-feed.ts and the run-feed / run-card components.
 *
 * Token fields (inputTokens, outputTokens, etc.) are zeroed — Paperclip
 * carries no per-call token counts. costUsd is derived from resultJson.costCents
 * when present, otherwise 0.
 *
 * kind is not part of RunRecord; invocationSource is not surfaced here but
 * is used in B2b–B2d.
 */
function mapToRunRecord(run: HeartbeatRun): z.infer<typeof RunRecord> {
  const costCents =
    run.resultJson != null && typeof run.resultJson["costCents"] === "number"
      ? (run.resultJson["costCents"] as number)
      : 0;

  return {
    id: run.id,
    agent: run.agentId,
    status: mapStatus(run.status),
    startedAt: run.startedAt ?? run.createdAt,
    endedAt: run.finishedAt,
    costUsd: costCents / 100,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    toolCalls: 0,
    errorMessage: null,
  };
}

// ---------------------------------------------------------------------------
// Paperclip branch
// ---------------------------------------------------------------------------

async function getPaperclipRuns(limit: number): Promise<Response> {
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

  const result = await client.heartbeatRuns({ limit });

  if (!result.ok) {
    return NextResponse.json(
      { error: `Paperclip heartbeatRuns failed: ${result.error}` },
      { status: 503 },
    );
  }

  const runs = result.data.map(mapToRunRecord);
  return NextResponse.json({ runs });
}

// ---------------------------------------------------------------------------
// Hermes branch (original — byte-for-byte)
// ---------------------------------------------------------------------------

const RUNS_PATH = process.env.AGENTICOS_RUNS_PATH ?? "/var/log/agenticos/runs.jsonl";

async function getHermesRuns(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);

  try {
    const content = await readFile(RUNS_PATH, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const recent = lines.slice(-limit).reverse();
    const runs = recent
      .map((line) => {
        try {
          return RunRecord.parse(JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter((r): r is z.infer<typeof RunRecord> => r !== null);
    return NextResponse.json({ runs });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ runs: [] });
    }
    return NextResponse.json(
      { runs: [], error: (err as Error).message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  if (dataSource() === "paperclip") {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
    return getPaperclipRuns(limit);
  }

  return getHermesRuns(req);
}
