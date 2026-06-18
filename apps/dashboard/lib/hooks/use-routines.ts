"use client";
import { useQuery } from "@tanstack/react-query";

export interface RoutineRow {
  id: string;
  name: string;
  enabled: boolean;
  cron: string | null;
  lastResult: string | null;
  managedByPlugin: string | null;
}

interface RoutinesResponse {
  routines: RoutineRow[];
}

export function useRoutines() {
  return useQuery<RoutinesResponse>({
    queryKey: ["routines"],
    queryFn: async () => {
      const res = await fetch("/api/routines");
      if (!res.ok) throw new Error(`routines fetch failed: HTTP ${res.status}`);
      return res.json() as Promise<RoutinesResponse>;
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
}
