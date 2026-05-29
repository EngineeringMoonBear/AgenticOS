"use client";
import { useQuery } from "@tanstack/react-query";
import type { RunsStats } from "@/app/api/tasks/stats/route";

/**
 * Aggregate KPI numbers for the Runs vista tiles. Polls every 30s
 * (alongside `useRecentRunEvents`) so the chart and tiles stay
 * roughly synchronised — same cadence, same query key prefix.
 */
export function useRunsStats() {
  return useQuery<RunsStats>({
    queryKey: ["runs", "stats"],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/tasks/stats", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load runs stats: HTTP ${res.status}`);
      }
      return (await res.json()) as RunsStats;
    },
  });
}
