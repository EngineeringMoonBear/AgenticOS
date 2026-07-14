"use client";
import { useQuery } from "@tanstack/react-query";
import type { ServicesHealthData } from "@/app/api/health/services/route";

/**
 * Live service probes for the Health tab — one real endpoint, shared by the
 * Agent-health panel and the Health vista tiles.
 *
 *   - /api/health/services → per-service up/down + measured probe latency
 *     (Paperclip or Hermes platform probe + OpenViking reachability)
 *
 * 30s polling like use-cost-vista; a service the route could not probe
 * arrives with latencyMs:null and renders "—" — never an invented number.
 */
export function useHealthServices() {
  return useQuery<ServicesHealthData>({
    queryKey: ["health", "services"],
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/health/services", { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/health/services → HTTP ${res.status}`);
      return (await res.json()) as ServicesHealthData;
    },
  });
}
