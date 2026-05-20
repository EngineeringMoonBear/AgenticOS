"use client";
import { useQuery } from "@tanstack/react-query";
import type { ScheduleRecord } from "@agenticos/hermes-client";

export function useHermesCron() {
  return useQuery({
    queryKey:  ["hermes", "cron"],
    staleTime: 30_000,
    queryFn: async (): Promise<ScheduleRecord[]> => {
      const res = await fetch("/api/hermes/cron");
      if (!res.ok) throw new Error("Failed to fetch cron");
      const json = await res.json();
      return json.schedules;
    },
  });
}
