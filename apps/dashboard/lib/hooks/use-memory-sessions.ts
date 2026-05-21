"use client";
import { useQuery } from "@tanstack/react-query";

export interface MemorySession {
  id: string;
  workspace_id: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export function useMemorySessions(limit: number = 20) {
  return useQuery<{ sessions: MemorySession[] }>({
    queryKey: ["memory", "sessions", limit],
    queryFn: async () => {
      const res = await fetch(`/api/memory/sessions?limit=${limit}`);
      if (!res.ok) throw new Error("failed to fetch sessions");
      return res.json();
    },
    staleTime: 30_000,
  });
}
