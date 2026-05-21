"use client";
import { useQuery } from "@tanstack/react-query";
import type { ScheduleRecord } from "@/lib/scheduler/types";

export function useCron() {
  return useQuery({
    queryKey: ["cron"],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ScheduleRecord[]> => {
      const res = await fetch("/api/cron");
      if (!res.ok) throw new Error("Failed to fetch cron");
      const json = await res.json();
      return json.schedules ?? [];
    },
  });
}
