"use client";
import { useQuery } from "@tanstack/react-query";
import type { ActivityStripEvent } from "@/components/shell/backdrops/ActivityStripBackdrop";
import type { RecentRunEvent } from "@/app/api/tasks/recent-events/route";

export interface RecentRunEventsResponse {
  events: RecentRunEvent[];
  windowMin: number;
}

/**
 * Live events powering the Runs throughput chart. Defaults to a 60-minute
 * window, matching the chart's plot area. Refetches every 30s so the chart
 * stays roughly fresh without hammering the DB; combined with the chart's
 * pinned `now` value, the visual updates smoothly on each refetch.
 *
 * The returned `events` are already shaped to satisfy `ActivityStripEvent`
 * so callers can pass them straight into the backdrop.
 */
export function useRecentRunEvents(windowMin: number = 60) {
  return useQuery<RecentRunEventsResponse, Error, ActivityStripEvent[]>({
    queryKey: ["runs", "recent-events", windowMin],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch(
        `/api/tasks/recent-events?windowMin=${windowMin}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error(`Failed to load recent run events: HTTP ${res.status}`);
      }
      return (await res.json()) as RecentRunEventsResponse;
    },
    // Strip the extra fields the chart doesn't need (`kind`, `id`) and
    // narrow to the chart's interface so consumers don't have to map.
    select: (r) =>
      r.events.map(
        (e): ActivityStripEvent => ({ at: e.at, status: e.status }),
      ),
  });
}
