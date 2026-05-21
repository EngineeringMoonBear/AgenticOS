"use client";
import { useQuery } from "@tanstack/react-query";

export interface AgentHealth {
  status: "ok" | "degraded";
  honcho: { reachable: boolean; latencyMs: number; error?: string };
}

export function useAgentHealth() {
  return useQuery<AgentHealth>({
    queryKey: ["agent", "health"],
    queryFn: async () => {
      const res = await fetch("/api/agent/health");
      if (!res.ok && res.status !== 503) throw new Error("health check failed");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
}
