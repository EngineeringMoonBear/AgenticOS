"use client";
import { useQuery } from "@tanstack/react-query";

export interface AgentRow {
  id: string;
  name: string;
  adapter: string | null;
  status: string;
  lastActivityAt: string | null;
}

interface AgentsResponse {
  agents: AgentRow[];
}

export function useAgents() {
  return useQuery<AgentsResponse>({
    queryKey: ["agents"],
    queryFn: async () => {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error(`agents fetch failed: HTTP ${res.status}`);
      return res.json() as Promise<AgentsResponse>;
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
}
