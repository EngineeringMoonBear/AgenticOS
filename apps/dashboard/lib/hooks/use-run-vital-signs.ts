"use client";
import { useEffect, useState } from "react";
import type { RunRecord } from "@/lib/agent";
import { useRunEvents } from "./use-run-events";

const DEFAULT_STALE_MS = 30_000;
const CURATOR_STALE_MS = 300_000;

export interface RunVitalSigns {
  runId: string;
  state: RunRecord["status"];
  lastEventAt: number;
  toolCallCount: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  isStale: boolean;
  throttledUntil?: string | undefined;
}

export function useRunVitalSigns(run: RunRecord | null): RunVitalSigns | null {
  const events = useRunEvents(run?.id ?? null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!run || run.status !== "running") return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [run]);

  if (!run) return null;

  const threshold = run.agent === "curator" ? CURATOR_STALE_MS : DEFAULT_STALE_MS;
  const lastEventAt = events.length > 0
    ? new Date(events[events.length - 1]!.ts).getTime()
    : new Date(run.startedAt).getTime();

  let throttledUntil: string | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === "tool_result") {
      const payload = e.payload as { retryAfter?: number } | null;
      if (payload?.retryAfter) {
        throttledUntil = new Date(lastEventAt + payload.retryAfter * 1000).toISOString();
        break;
      }
    }
  }

  return {
    runId:           run.id,
    state:           run.status,
    lastEventAt,
    toolCallCount:   events.filter((e) => e.kind === "tool_call").length,
    costUsd:         run.costUsd ?? 0,
    inputTokens:     run.inputTokens,
    outputTokens:    run.outputTokens,
    isStale:         run.status === "running" && now - lastEventAt > threshold,
    throttledUntil,
  };
}
