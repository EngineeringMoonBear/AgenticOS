"use client";
import { useQuery } from "@tanstack/react-query";
import type { NextCronInfo } from "@/app/api/crons/next/route";

/**
 * Polls `/api/crons/next` every 30s — same cadence as the other Runs
 * vista hooks. Returns `null` from the API when no registered cron has
 * a computable next-fire (an unsatisfiable schedule, like `0 0 30 2 *`).
 */
export function useNextCron() {
  return useQuery<NextCronInfo | null>({
    queryKey: ["runs", "next-cron"],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/crons/next", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load next cron: HTTP ${res.status}`);
      }
      return (await res.json()) as NextCronInfo | null;
    },
  });
}
