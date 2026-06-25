import { z } from "zod";
import { RunRecord } from "@/lib/agent";
import type { HeartbeatRun } from "@/lib/paperclip/client";

// ---------------------------------------------------------------------------
// Paperclip → RunRecord status mapping
// Source statuses from vendor/paperclip/packages/shared/src/constants.ts:644
// "queued"|"scheduled_retry"|"running"|"succeeded"|"failed"|"cancelled"|"timed_out"
// ---------------------------------------------------------------------------

export function mapStatus(paperclipStatus: string): z.infer<typeof RunRecord>["status"] {
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
export function mapToRunRecord(run: HeartbeatRun): z.infer<typeof RunRecord> {
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
